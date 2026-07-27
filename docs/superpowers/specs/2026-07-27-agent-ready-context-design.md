# Agent-Ready Context Design

## Goal

Produce a structured, verified technical brief that a later coding agent can
use to locate implementation work, understand runtime behavior, and select
appropriate verification steps.

## Context Shape

The context JSON keeps its existing summary, technology, command, risk, and
open-question fields. It adds these structured fields:

- `projectMap`: important directories and files, each with a purpose and key
  symbols or responsibilities.
- `systems`: cohesive runtime systems with their purpose, responsible files,
  dependencies, and integration boundaries.
- `dataFlows`: named request, event, or state flows with ordered steps and
  involved files.
- `configuration`: configuration files, relevant environment variables, and
  runtime effects.
- `changeGuide`: common change areas, likely files, and implementation risks.
- `verification`: verified commands, test coverage, and known verification
  gaps.

Existing fields remain for compatibility with saved project contexts. The
renderer normalization step preserves all new fields so local context edits and
the prompt-generation pass receive the full brief.

## Extraction Rules

The context agent receives the file manifest and sampled source content. It
must use read-only shell tools to read the complete contents of key files and
any sampled file marked as truncated before describing it. It must distinguish
verified facts from gaps, never infer API behavior, data flows, or configuration
keys solely from names.

## Prompt Generation

The prompt-generation pass receives the expanded context object unchanged. It
uses `projectMap`, `systems`, `dataFlows`, `changeGuide`, and `verification` to
name the relevant files, constraints, risks, and concrete verification steps.

## Acceptance Criteria

- Context includes all six new structured sections.
- Each project map or system item names exact relative paths.
- Data flows name ordered steps and involved files.
- Truncated key files are read in full with read-only shell tools.
- Saved and edited contexts preserve all new sections.
- Generated prompts retain the structured context for implementation guidance.
