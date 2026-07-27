# Luna Context Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use `gpt-5.6-luna` with high reasoning effort for both Prompt Studio operations and request a detailed project context.

**Architecture:** `MODEL_CONFIG` in `app.js` and the main-process fallbacks both use Luna/high. The context prompt explicitly requests concrete architecture, directory responsibilities, and data flow; Node tests protect these requirements.

**Tech Stack:** Vanilla JavaScript, Node.js built-in test runner, Electron renderer.

## Global Constraints

- Keep the context pass read-only.
- Use model `gpt-5.6-luna` and reasoning effort `high` for both stages.
- Do not alter Prompt Studio persistence, IPC contracts, or UI layout.

---

### Task 1: Align Prompt Studio Model Configuration

**Files:**
- Modify: `app.js:32-35`
- Modify: `main.js:320-365, 440-445`
- Modify: `README.md:37`
- Modify: `test/context-prompt.test.js`

**Interfaces:**
- Consumes: `MODEL_CONFIG.context` and `MODEL_CONFIG.prompt` in `app.js`.
- Produces: Both Codex payloads use `{ model: 'gpt-5.6-luna', reasoning: 'high' }` and context extraction requests a detailed factual brief.

- [ ] **Step 1: Write the failing test**

Add this test to `test/context-prompt.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/context-prompt.test.js`

Expected: The context assertion fails because it receives `gpt-5.4-mini` and `medium`.

- [ ] **Step 3: Write minimal implementation**

Replace the context entry in `app.js` with:

```js
context: { model: 'gpt-5.6-luna', reasoning: 'high' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/context-prompt.test.js`

Expected: Both tests pass.

- [ ] **Step 5: Verify syntax**

Run: `node -c app.js`

Expected: Exit code 0.

### Task 2: Enrich Context Instructions

**Files:**
- Modify: `main.js:346-363`
- Modify: `test/context-prompt.test.js`

**Interfaces:**
- Consumes: The existing `CONTEXT_SCHEMA` fields.
- Produces: A prompt that asks for project purpose, directory responsibilities, architecture, data flow, commands, conventions, and risks.

- [ ] **Step 1: Extend the prompt regression test**

Assert that the generated context prompt contains `detailed, factual project context`, `responsibilities of important directories`, and `data flow`.

- [ ] **Step 2: Update the context instruction**

Require the context agent to explain the project's purpose, technologies, architecture, important directory and module responsibilities, data flow, integration boundaries, entry points, commands, conventions, and risks.

- [ ] **Step 3: Verify**

Run: `node --test test/context-prompt.test.js && node -c main.js && node -c app.js`

Expected: All tests pass and both syntax checks exit with code 0.
