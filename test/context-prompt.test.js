const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const match = source.match(/function contextPrompt\(inventory\) \{[\s\S]*?\n\}\n\nfunction promptGenerationInput/);

if (!match) throw new Error('Could not load contextPrompt from main.js.');

const context = {
  compactManifest: () => 'src/nested/feature.js (128 bytes)',
  compactFileContents: () => '--- src/nested/feature.js ---\nfunction hello() { return "world"; }',
};
vm.runInNewContext(match[0].replace('\n\nfunction promptGenerationInput', ''), context);

test('context prompt produces an agent-ready technical brief', () => {
  const prompt = context.contextPrompt({ includedFiles: [] });

  assert.match(prompt, /root README/i);
  assert.match(prompt, /README content may be stale/i);
  assert.match(prompt, /do not infer behavior from filenames alone/i);
  assert.match(prompt, /detailed, factual project context/i);
  assert.match(prompt, /projectMap with exact relative paths/i);
  assert.match(prompt, /read the complete contents/i);
  assert.match(prompt, /projectMap/);
  assert.match(prompt, /dataFlows/);
  assert.match(prompt, /changeGuide/);
  assert.match(prompt, /--- src\/nested\/feature.js ---/);
});

test('context content prioritizes root README and project manifests', () => {
  const priorityMatch = source.match(/const CONTEXT_MANIFEST_FILES[\s\S]*?\n\nfunction compactFileContents/);
  if (!priorityMatch) throw new Error('Could not load context file ordering helpers.');
  const priorityContext = {};
  vm.runInNewContext(priorityMatch[0].replace('\n\nfunction compactFileContents', ''), priorityContext);
  const ordered = priorityContext.orderedContextFiles([
    { path: 'src/index.js', bytes: 10 },
    { path: 'README.md', bytes: 10 },
    { path: 'package.json', bytes: 10 },
    { path: 'docs/README.md', bytes: 10 },
    { path: 'src/package.json', bytes: 10 },
  ]);
  assert.equal(ordered.map(file => file.path).join('|'), 'README.md|package.json|docs/README.md|src/package.json|src/index.js');
  assert.match(source, /Start by checking whether the repository has a root README file/);
  assert.match(source, /README content may be stale/);
});

test('Prompt Studio uses Luna with high reasoning for both stages', () => {
  const configMatch = appSource.match(/const MODEL_CONFIG = \{[\s\S]*?\n\};/);
  if (!configMatch) throw new Error('Could not load MODEL_CONFIG from app.js.');
  const modelContext = {};
  vm.runInNewContext(configMatch[0].replace('const MODEL_CONFIG', 'MODEL_CONFIG'), modelContext);

  assert.equal(modelContext.MODEL_CONFIG.context.model, 'gpt-5.6-luna');
  assert.equal(modelContext.MODEL_CONFIG.context.reasoning, 'high');
  assert.equal(modelContext.MODEL_CONFIG.prompt.model, 'gpt-5.6-luna');
  assert.equal(modelContext.MODEL_CONFIG.prompt.reasoning, 'high');
});

test('context extraction defaults to Luna with high reasoning', () => {
  assert.match(source, /model: payload\.model \|\| 'gpt-5\.6-luna'/);
  assert.match(source, /reasoning: payload\.reasoning \|\| 'high'/);
  assert.doesNotMatch(source, /payload\.model \|\| 'gpt-5\.4-mini'/);
});

test('Codex stdin errors settle the run instead of crashing Electron', () => {
  assert.match(source, /child\.stdin\.on\('error', err => \{ stdinError = err; \}\)/);
  assert.match(source, /if \(stdinError\) \{/);
});

test('Codex runs allow up to fifteen minutes for large projects', () => {
  assert.match(source, /const CODEX_TIMEOUT_MS = 15 \* 60 \* 1000/);
  assert.match(source, /Codex timed out after fifteen minutes/);
  assert.doesNotMatch(source, /Codex timed out after five minutes/);
});

const normalizeMatch = source.match(/function normalizeError\(err, fallback = 'Codex could not complete the run\.'\) \{[\s\S]*?\n\}\n\nfunction parseJsonOutput/);
if (!normalizeMatch) throw new Error('Could not load normalizeError from main.js.');
const errorContext = {};
vm.runInNewContext(normalizeMatch[0].replace('\n\nfunction parseJsonOutput', ''), errorContext);

test('Luna compatibility failures explain that Codex must be updated', () => {
  const message = errorContext.normalizeError(new Error('The gpt-5.6-luna model requires a newer version of Codex.'));

  assert.match(message, /update Codex/i);
  assert.match(message, /gpt-5\.6-luna/);
});

test('Codex CMD launchers bypass the shell for project paths with spaces', () => {
  assert.match(source, /function codexScript\(command\)/);
  assert.match(source, /spawn\('node\.exe', \[script, \.\.\.args\]/);
  assert.match(source, /shell: false/);
  assert.match(source, /spawn\(process\.env\.ComSpec \|\| 'cmd\.exe'/);
  assert.match(source, /spawnCodex\(command, args,/);
});

test('project scanning ignores editor and agent metadata folders', () => {
  for (const directory of ['.codex', '.zed', '.vscode', '.idea']) {
    assert.match(source, new RegExp(`['"]${directory}['"]`));
  }
});

test('context schema requires structured agent-ready sections', () => {
  for (const field of ['projectMap', 'systems', 'dataFlows', 'configuration', 'changeGuide', 'verification']) {
    assert.match(source, new RegExp(`\\b${field}\\b`));
  }
});

test('renderer preserves structured context sections', () => {
  for (const field of ['projectMap', 'systems', 'dataFlows', 'configuration', 'changeGuide', 'verification']) {
    assert.match(appSource, new RegExp(`\\b${field}:`));
  }
});
