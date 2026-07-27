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
const MAX_FILE_CONTENT_CHARS = 8000;
const MAX_CONTENT_BUDGET_CHARS = 100000;

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
  const configuredCandidates = [process.env.DECK_CODEX_BIN, process.env.CODEX_CLI_PATH].filter(Boolean);
  const configuredCommand = configuredCandidates.find(candidate => !path.isAbsolute(candidate) || fs.existsSync(candidate));
  if (configuredCommand) return configuredCommand;

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const installedCandidates = [
      path.join(localAppData, 'pnpm', 'bin', 'codex.CMD'),
      path.join(appData, 'npm', 'codex.cmd'),
      path.join(localAppData, 'npm', 'codex.cmd'),
    ];
    const installedPath = installedCandidates.find(candidate => fs.existsSync(candidate));
    if (installedPath) return installedPath;
  }

  return process.platform === 'win32' ? 'codex.cmd' : 'codex';
}

function codexSpawnOptions(command, extra = {}) {
  return {
    ...extra,
    env: { ...process.env },
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
  };
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
  ];

  return new Promise((resolve, reject) => {
    const command = codexCommand();
    const child = spawn(command, args, codexSpawnOptions(command, {
      cwd: rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    }));

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
    child.stdin.on('error', err => finish(new Error(normalizeError(err))));
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

    child.stdin.end(prompt, 'utf8');
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

function compactFileContents(inventory) {
  let budget = MAX_CONTENT_BUDGET_CHARS;
  const root = inventory.rootPath;
  const parts = [];

  for (const file of inventory.includedFiles) {
    if (budget <= 0) break;
    const fullPath = path.join(root, file.path);
    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch (_) {
      continue;
    }
    const trimmed = content.length > MAX_FILE_CONTENT_CHARS
      ? content.slice(0, MAX_FILE_CONTENT_CHARS) + '\n... [file content truncated]'
      : content;
    budget -= trimmed.length + file.path.length + 20;
    parts.push(`--- ${file.path} ---\n${trimmed}`);
  }

  return parts.join('\n\n');
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
  const manifest = compactManifest(inventory);
  const contents = compactFileContents(inventory);

  return `You are Deck's read-only project context archivist.

Read the repository files below and produce a detailed, factual project context for a later coding-agent prompt. Explain the project's purpose, technologies, architecture, responsibilities of important directories and modules, data flow and integration boundaries, entry points, commands, conventions, and risks. Do not modify files, run destructive commands, or reveal secret values. Do not read or quote sensitive files such as .env files, private keys, certificates, credentials, or secrets.

Analyze the actual source code, configuration, and documentation in the file contents below to extract technologies, architecture, entry points, key files, conventions, build commands, and risks. If the file contents are truncated, note that in openQuestions. Do not invent technologies, commands, or architecture: if something cannot be verified from the provided contents, put it in openQuestions.

Return only the JSON object required by the supplied schema. Keep the summary compact, but make architecture and conventions specific enough for a later agent to understand how the project works. Include exact relative paths for keyFiles and entryPoints, and exact commands only when they are present in the repository documentation or configuration.

Project file inventory:
${manifest}

File contents:
${contents}`;
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
  const command = codexCommand();
  const child = spawn(command, ['--version'], codexSpawnOptions(command, {
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  let output = '';
  let error = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { error += String(chunk); });
  child.on('error', err => resolve({ available: false, command, error: normalizeError(err) }));
  child.on('close', code => resolve({
    available: code === 0,
    command,
    version: (output || error).trim(),
    error: code === 0 ? null : normalizeError(new Error(error.trim() || 'Codex exited with code ' + code + '.')),
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
    model: payload.model || 'gpt-5.6-luna',
    reasoning: payload.reasoning || 'high',
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
    backgroundColor: '#f7f7f4',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Landing first, user clicks "Open Deck" to reach the catalog
  win.loadFile('landing.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
