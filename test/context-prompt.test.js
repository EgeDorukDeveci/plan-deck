const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
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
  assert.match(prompt, /--- src\/nested\/feature.js ---/);
});
