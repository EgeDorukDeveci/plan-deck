// Electron main process for Deck.
// The renderer can store cards locally and ask this process to run a
// read-only Codex CLI pass over a user-selected project.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const activeRuns = new Map();
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_MANIFEST_CHARS = 180000;

const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build',
  'coverage', 'target', '.venv', '.next', '.nuxt', '.turbo', 'out',
]);

const SECRET_FILE_RE = /(^|\/)(\.env(?:\..*)?|credentials?\..*|secrets?\..*)$|\.(pem|key|p12|pfx|keystore)$/i;
const BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|tar|gz|7z|rar|exe|dll|so|dylib|class|jar|woff2?|ttf|otf|mp[34]|mov|avi|mkv)$/i;

function dataFile() {
  return path.join(app.getPath('userData'), 'deck-data.json');
}

function codexCommand() {
  if (process.env.DECK_CODEX_BIN) return process.env.DECK_CODEX_BIN;
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  return process.platform === 'win32' ? 'codex.cmd' : 'codex';
}

function safeSend(sender, channel, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send(channel, payload);
  } catch (_) {}
}

function normalizeError(err, fallback = 'Codex could not complete the run.') {
  const message = String(err?.message || err || fallback);
  if (/ENOENT|not found|is not recognized/i.test(message)) {
    return 'Codex CLI was not found. Install Codex or set DECK_CODEX_BIN to its executable path.';
  }
  if (/login|auth|unauthorized|authentication/i.test(message)) {
    return 'Codex is not logged in. Run `codex login` in a terminal, then try again.';
  }
  return message;
}

function parseJsonOutput(raw) {
  const source = String(raw || '').trim();
  if (!source) throw new Error('Codex returned an empty response.');

  const unfenced = source
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try { return JSON.parse(unfenced); } catch (_) {}

  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(unfenced.slice(first, last + 1)); } catch (_) {}
  }
  throw new Error('Codex returned invalid JSON. The run can be retried with the same project.');
}

function removeTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function runCodex({ sender, rootPath, model, reasoning, prompt, schema }) {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-codex-'));
  const schemaPath = path.join(tempDir, 'schema.json');
  const outputPath = path.join(tempDir, 'output.json');
  fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2), 'utf8');

  const args = [
    'exec',
    '--model', model,
    '--sandbox', 'read-only',
    '--ephemeral',
    '--skip-git-repo-check',
    '--color', 'never',
    '-C', rootPath,
    '--output-schema', schemaPath,
    '--output-last-message', outputPath,
    '-c', `model_reasoning_effort=${JSON.stringify(reasoning)}`,
    prompt,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(codexCommand(), args, {
      cwd: rootPath,
      env: { ...process.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const run = { child, tempDir, settled: false, timer: null, reject };
    activeRuns.set(runId, run);
    safeSend(sender, 'deck:codex-started', { runId });

    let stdout = '';
    let stderr = '';
    const append = (target, chunk) => String(target + chunk).slice(-12000);

    child.stdout.on('data', chunk => {
      stdout = append(stdout, chunk);
      safeSend(sender, 'deck:codex-progress', {
        runId,
        stream: 'stdout',
        text: String(chunk).trim(),
      });
    });
    child.stderr.on('data', chunk => {
      stderr = append(stderr, chunk);
      safeSend(sender, 'deck:codex-progress', {
        runId,
        stream: 'stderr',
        text: String(chunk).trim(),
      });
    });

    const finish = (error, result) => {
      if (run.settled) return;
      run.settled = true;
      if (run.timer) clearTimeout(run.timer);
      activeRuns.delete(runId);
      removeTempDir(tempDir);
      if (error) reject(error);
      else resolve({ runId, result });
    };

    run.timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish(new Error('Codex timed out after five minutes. You can retry this run.'));
    }, 5 * 60 * 1000);

    child.on('error', err => finish(new Error(normalizeError(err))));
    child.on('close', code => {
      if (run.settled) return;
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim();
        finish(new Error(normalizeError(new Error(detail || `Codex exited with code ${code}.`))));
        return;
      }

      try {
        const raw = fs.readFileSync(outputPath, 'utf8');
        finish(null, parseJsonOutput(raw));
      } catch (err) {
        finish(new Error(normalizeError(err)));
      }
    });
  });
}

function ensureDirectory(rootPath) {
  if (typeof rootPath !== 'string' || !rootPath.trim()) {
    throw new Error('Choose a project directory first.');
  }
  const resolved = path.resolve(rootPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('The selected project directory no longer exists.');
  }
  return resolved;
}

function isSecretOrBinary(relativePath, stat, fullPath) {
  const normalized = relativePath.replaceAll(path.sep, '/');
  if (SECRET_FILE_RE.test(normalized) || BINARY_EXT_RE.test(relativePath) || stat.size > MAX_FILE_BYTES) return true;
  try {
    const fd = fs.openSync(fullPath, 'r');
    const sample = Buffer.alloc(4096);
    const count = fs.readSync(fd, sample, 0, sample.length, 0);
    fs.closeSync(fd);
    return sample.subarray(0, count).includes(0);
  } catch (_) {
    return false;
  }
}

function inspectProject(rootPath) {
  const root = ensureDirectory(rootPath);
  const includedFiles = [];
  const excludedFiles = [];
  let truncated = false;

  function walk(dir, depth = 0) {
    if (depth > 30 || includedFiles.length >= MAX_FILES) {
      truncated = true;
      return;
    }

    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (includedFiles.length >= MAX_FILES) { truncated = true; return; }
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replaceAll(path.sep, '/');

      if (entry.isSymbolicLink()) {
        excludedFiles.push({ path: rel, reason: 'symlink' });
        continue;
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          excludedFiles.push({ path: `${rel}/`, reason: 'generated or dependency directory' });
          continue;
        }
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; }
      if (isSecretOrBinary(rel, stat, full)) {
        const reason = SECRET_FILE_RE.test(rel) ? 'sensitive file' : 'binary or too large';
        excludedFiles.push({ path: rel, reason });
        continue;
      }
      includedFiles.push({ path: rel, bytes: stat.size });
    }
  }

  walk(root);
  includedFiles.sort((a, b) => a.path.localeCompare(b.path));
  excludedFiles.sort((a, b) => a.path.localeCompare(b.path));

  return {
    rootPath: root,
    name: path.basename(root),
    includedFiles,
    excludedFiles,
    truncated,
    includedCount: includedFiles.length,
    excludedCount: excludedFiles.length,
    includedBytes: includedFiles.reduce((sum, file) => sum + file.bytes, 0),
  };
}

function compactManifest(inventory) {
  const lines = inventory.includedFiles.map(file => `${file.path} (${file.bytes} bytes)`);
  const text = lines.join('\n');
  return text.length > MAX_MANIFEST_CHARS ? `${text.slice(0, MAX_MANIFEST_CHARS)}\n[manifest truncated]` : text;
}

const CONTEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    technologies: { type: 'array', items: { type: 'string' } },
    architecture: { type: 'string' },
    entryPoints: { type: 'array', items: { type: 'string' } },
    keyFiles: { type: 'array', items: { type: 'string' } },
    conventions: { type: 'array', items: { type: 'string' } },
    commands: {
      type: 'object',
      additionalProperties: false,
      properties: {
        install: { type: 'string' },
        dev: { type: 'string' },
        test: { type: 'string' },
        lint: { type: 'string' },
        build: { type: 'string' },
      },
      required: ['install', 'dev', 'test', 'lint', 'build'],
    },
    risks: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'summary', 'technologies', 'architecture', 'entryPoints', 'keyFiles',
    'conventions', 'commands', 'risks', 'openQuestions',
  ],
};

const PROMPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    prompt: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
    suggestedFiles: { type: 'array', items: { type: 'string' } },
    verificationSteps: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'prompt', 'assumptions', 'openQuestions', 'suggestedFiles', 'verificationSteps'],
};

function contextPrompt(inventory) {
  return `You are Deck's read-only project context archivist.

Inspect the current repository and produce a durable, factual context brief for a later coding-agent prompt. Do not modify files, run destructive commands, or reveal secret values. Do not open or quote sensitive files such as .env files, private keys, certificates, credentials, or secrets. Treat the file inventory below as the allowed project surface. Do not invent technologies, commands, architecture, or files: if something cannot be verified, put it in openQuestions.

Return only the JSON object required by the supplied schema. Keep the summary compact but useful. Include exact relative paths for keyFiles and entryPoints, and exact commands only when they are present in the repository documentation or configuration.

Project file inventory:
${compactManifest(inventory)}`;
}

function promptGenerationInput({ idea, context, guide, language }) {
  return JSON.stringify({
    idea,
    projectContext: context,
    promptGuide: guide,
    requestedLanguage: language,
    outputRequirements: [
      'Write the generated coding prompt in the requested language.',
      'Preserve verified project facts and mark uncertainty instead of inventing details.',
      'Include goal, relevant context, expected implementation, constraints, likely files, acceptance criteria, verification commands, open questions, and an autonomy boundary.',
      'The output is a prompt for a later coding agent, not a code change and not an explanation of your own process.',
    ],
  }, null, 2);
}

function promptGenerationInstructions(input) {
  return `You are Deck's project-aware prompt editor. Do not modify the repository. Use the JSON input below to turn one rough idea into a precise, agent-ready coding prompt. Keep it lean: state each instruction once, preserve important context and constraints, and explicitly describe success criteria and verification. If the idea is ambiguous, record the ambiguity in openQuestions and make the prompt ask the coding agent to clarify before making a risky change.

JSON input:
${input}

Return only the JSON object required by the supplied schema.`;
}

ipcMain.handle('deck:load', () => {
  try { return fs.readFileSync(dataFile(), 'utf-8'); }
  catch (_) { return null; }
});

ipcMain.handle('deck:save', (_event, json) => {
  try {
    fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
    fs.writeFileSync(dataFile(), json, 'utf-8');
    return true;
  } catch (err) {
    console.error('Deck: failed to save data:', err);
    return false;
  }
});

ipcMain.handle('deck:data-path', () => dataFile());

ipcMain.handle('codex:check', () => new Promise(resolve => {
  const child = spawn(codexCommand(), ['--version'], {
    env: { ...process.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let error = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { error += String(chunk); });
  child.on('error', err => resolve({ available: false, command: codexCommand(), error: normalizeError(err) }));
  child.on('close', code => resolve({
    available: code === 0,
    command: codexCommand(),
    version: (output || error).trim(),
    error: code === 0 ? null : normalizeError(new Error(error.trim() || `Codex exited with code ${code}.`)),
  }));
}));

ipcMain.handle('project:pick', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose a project folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return inspectProject(result.filePaths[0]);
});

ipcMain.handle('project:inspect', (_event, rootPath) => inspectProject(rootPath));

ipcMain.handle('codex:extract-context', async (event, payload = {}) => {
  const rootPath = ensureDirectory(payload.rootPath);
  const inventory = inspectProject(rootPath);
  const run = await runCodex({
    sender: event.sender,
    rootPath,
    model: payload.model || 'gpt-5.4-mini',
    reasoning: payload.reasoning || 'medium',
    prompt: contextPrompt(inventory),
    schema: CONTEXT_SCHEMA,
  });
  return { ...run, inventory };
});

ipcMain.handle('codex:generate-prompt', async (event, payload = {}) => {
  const rootPath = ensureDirectory(payload.rootPath);
  const input = promptGenerationInput({
    idea: String(payload.idea || '').trim(),
    context: payload.context || {},
    guide: String(payload.guide || '').trim(),
    language: payload.language === 'tr' ? 'tr' : 'en',
  });
  const run = await runCodex({
    sender: event.sender,
    rootPath,
    model: payload.model || 'gpt-5.6-luna',
    reasoning: payload.reasoning || 'high',
    prompt: promptGenerationInstructions(input),
    schema: PROMPT_SCHEMA,
  });
  return run;
});

ipcMain.handle('codex:cancel', (_event, runId) => {
  const run = activeRuns.get(runId);
  if (!run) return false;
  try { run.child.kill(); } catch (_) {}
  if (!run.settled) {
    run.settled = true;
    if (run.timer) clearTimeout(run.timer);
    activeRuns.delete(runId);
    removeTempDir(run.tempDir);
    run.reject(new Error('Codex run cancelled.'));
  }
  return true;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#e9e3d6',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
