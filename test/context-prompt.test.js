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
};
vm.runInNewContext(match[0].replace('\n\nfunction promptGenerationInput', ''), context);

test('context prompt requires direct inspection of nested project files', () => {
  const prompt = context.contextPrompt({ includedFiles: [] });

  assert.match(prompt, /read-only shell commands/i);
  assert.match(prompt, /nested directories/i);
  assert.match(prompt, /not a substitute for reading the files/i);
});
