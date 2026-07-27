# Luna Context Model Design

## Goal

Use `gpt-5.6-luna` with high reasoning effort for both Prompt Studio
operations: project-context extraction and coding-prompt generation.

## Design

`MODEL_CONFIG` in `app.js` remains the single source of model configuration.
Its `context` entry changes from `gpt-5.4-mini` with `medium` reasoning to
`gpt-5.6-luna` with `high` reasoning. The existing IPC payloads already read
both fields from that entry, so no main-process or UI changes are required.

## Acceptance Criteria

- The context extraction payload uses model `gpt-5.6-luna`.
- The context extraction payload uses reasoning effort `high`.
- Prompt generation remains on `gpt-5.6-luna` with reasoning effort `high`.
- A regression test verifies both configuration entries.
