# Agent-Ready Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Prompt Studio context extraction into a structured, verified technical brief for later coding agents.

**Architecture:** Expand the main-process JSON schema and its extraction instructions, then preserve the new fields in the renderer’s context normalization. The existing editable JSON context view and prompt-generation request continue to pass the whole context object unchanged.

**Tech Stack:** Electron main process, vanilla JavaScript renderer, Codex CLI, Node.js built-in test runner.

## Global Constraints

- Keep Codex runs read-only and do not expose sensitive files.
- Every referenced project path must be exact and relative to the selected root.
- Treat sampled content as incomplete when marked truncated; use read-only shell tools to read critical files in full.
- Preserve existing saved context fields and prompt-generation behavior.

---

### Task 1: Define Structured Context Schema

**Files:**
- Modify: `main.js:332-361`
- Modify: `test/context-prompt.test.js`

**Interfaces:**
- Consumes: Codex structured output from `codex:extract-context`.
- Produces: Required `projectMap`, `systems`, `dataFlows`, `configuration`, `changeGuide`, and `verification` fields.

- [ ] **Step 1: Write failing schema test**

Add assertions that `CONTEXT_SCHEMA` requires these names:

```js
for (const field of ['projectMap', 'systems', 'dataFlows', 'configuration', 'changeGuide', 'verification']) {
  assert.match(source, new RegExp(`\\b${field}\\b`));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/context-prompt.test.js`

Expected: The schema test fails because the new field names are absent.

- [ ] **Step 3: Add schema fields**

Add arrays of strict objects with exact path-bearing fields:

```js
projectMap: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
  path: { type: 'string' }, kind: { type: 'string' }, purpose: { type: 'string' }, keySymbols: { type: 'array', items: { type: 'string' } },
}, required: ['path', 'kind', 'purpose', 'keySymbols'] } },
```

Use equivalent objects for systems (`name`, `purpose`, `files`, `dependencies`, `boundaries`), flows (`name`, `trigger`, `steps`, `files`), configuration (`path`, `purpose`, `keys`, `effects`), change guide (`area`, `likelyFiles`, `risks`), and verification (`commands`, `coverage`, `gaps`). Add all fields to `required`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/context-prompt.test.js`

Expected: Schema test passes.

### Task 2: Require Complete Technical Investigation

**Files:**
- Modify: `main.js:381-393`
- Modify: `test/context-prompt.test.js`

**Interfaces:**
- Consumes: Manifest and sampled file contents.
- Produces: Explicit instructions to inspect full key files and fill each structured context section with verified facts.

- [ ] **Step 1: Write failing prompt assertions**

Require `contextPrompt()` to contain `read the complete contents`, `projectMap`, `dataFlows`, and `changeGuide`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/context-prompt.test.js`

Expected: Prompt assertion fails because full-file reads and structured section names are not mandated.

- [ ] **Step 3: Update extraction instruction**

Tell the agent to use read-only shell tools for full critical-file reads, especially files marked truncated, and specify the expected facts for every structured field.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/context-prompt.test.js`

Expected: Prompt assertions pass.

### Task 3: Preserve Structured Context in Renderer State

**Files:**
- Modify: `app.js:448-466`
- Modify: `test/context-prompt.test.js`

**Interfaces:**
- Consumes: Extended context JSON from main process or saved project state.
- Produces: Normalized arrays and verification object passed to `contextEditorValue()` and `generateStudioPrompt()`.

- [ ] **Step 1: Write failing normalization assertions**

Assert `normalizeContext()` retains `projectMap`, `systems`, `dataFlows`, `configuration`, `changeGuide`, and `verification`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/context-prompt.test.js`

Expected: Renderer assertion fails because the fields are currently discarded.

- [ ] **Step 3: Normalize new fields**

Return arrays for the first five fields and this object for verification:

```js
verification: {
  commands: Array.isArray(c.verification?.commands) ? c.verification.commands : [],
  coverage: String(c.verification?.coverage || ''),
  gaps: Array.isArray(c.verification?.gaps) ? c.verification.gaps : [],
},
```

- [ ] **Step 4: Run final verification**

Run: `node --test test/context-prompt.test.js && node -c main.js && node -c app.js`

Expected: All tests pass and both syntax checks exit with code 0.
