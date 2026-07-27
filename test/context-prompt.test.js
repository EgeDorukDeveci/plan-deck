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

test('context prompt includes file contents for all nested directories', () => {
  const prompt = context.contextPrompt({ includedFiles: [] });

  assert.match(prompt, /file contents below/i);
  assert.match(prompt, /analyze the actual source code/i);
  assert.match(prompt, /detailed, factual project context/i);
  assert.match(prompt, /data flow/i);
  assert.match(prompt, /responsibilities of important directories/i);
  assert.match(prompt, /--- src\/nested\/feature.js ---/);
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

const normalizeMatch = source.match(/function normalizeError\(err, fallback = 'Codex could not complete the run\.'\) \{[\s\S]*?\n\}\n\nfunction parseJsonOutput/);
if (!normalizeMatch) throw new Error('Could not load normalizeError from main.js.');
const errorContext = {};
vm.runInNewContext(normalizeMatch[0].replace('\n\nfunction parseJsonOutput', ''), errorContext);

test('Luna compatibility failures explain that Codex must be updated', () => {
  const message = errorContext.normalizeError(new Error('The gpt-5.6-luna model requires a newer version of Codex.'));

  assert.match(message, /update Codex/i);
  assert.match(message, /gpt-5\.6-luna/);
});
