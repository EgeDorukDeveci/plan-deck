# Deck

A personal card catalog for ideas, plans, tasks, and notes. Local-first: everything lives in your browser's `localStorage` or the Electron data file. The optional Prompt Studio uses your existing Codex CLI login to map a selected project and turn cards into project-aware coding prompts.

## Run it as a web page

Open `landing.html` for the introduction page, or go straight to `index.html` for the app itself. No build step, no server, no dependencies.

## Run it as a desktop app

The app has zero network dependencies (system fonts only, no CDN calls), so it's ready to wrap in Electron as-is.

```bash
npm install
npm start
```

This opens Deck in its own native window via `main.js`. To package a distributable `.exe`/`.app`/`.AppImage`, add [`electron-builder`](https://www.electron.build/) or [`electron-forge`](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging) as a dev dependency and follow their packaging docs; `main.js` and `index.html` need no changes for either.

## Files

| File | Purpose |
|---|---|
| `index.html` | The app shell (markup only) |
| `landing.html` | Introduction / marketing page, links into the app |
| `style.css` | Full design system: tokens, both themes, all app components |
| `landing.css` | Landing-page-only layout, reuses `style.css` tokens and card components |
| `theme.js` | Shared Day / Night theme logic, used by both pages |
| `app.js` | App state, rendering, persistence, keyboard shortcuts |
| `main.js` | Electron entry point (desktop wrapper only, loads `index.html` directly, no landing page) |
| `PRODUCT.md` | Design brief: who it's for, what it should feel like |
| `DESIGN.md` | Design tokens and component spec |

## Prompt Studio

Prompt Studio is available in the Electron app. Choose a project folder, review the files Deck will expose to Codex, and run the read-only context pass with `gpt-5.4-mini`. After approving the generated context, select a card and generate an agent-ready prompt with `gpt-5.6-luna` at high reasoning effort. The final prompt stays editable and can be copied to any coding agent; generated versions are saved under the source card.

The desktop app expects the `codex` CLI to be installed and logged in. If it is not on `PATH`, set `DECK_CODEX_BIN` to the executable path before starting Deck.

## Shortcuts

| Key | Action |
|---|---|
| `⌘↵` / `Ctrl+Enter` | File the current card |
| `⌘K` / `Ctrl+K` | Focus search |
| `⌘N` / `Ctrl+N` | Focus the capture field |
| `1`–`4` | Switch card type while writing |
| `Esc` | Clear filter / close drawer |
