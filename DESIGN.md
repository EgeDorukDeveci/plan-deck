# Design

## Concept

Deck is a digital card catalog. The workspace is a "desk" (page background); collections are drawer tabs in a rail on the left; the capture area is a blank index card at the top of a small stack; every saved note is a card in the catalog grid with a printed catalog number and a rubber-stamp style type badge. Two themes share the exact same structure: **Day** (paper on a felt desk) and **Night** (ink on dark paper, reading-lamp light).

## Color

Strategy: **Committed**. One accent (oxblood/brass) carries all primary interaction. Four muted "ink" colors carry the note types, styled like stamp inks rather than saturated SaaS colors.

### Day theme
| Token | Value | Use |
|---|---|---|
| `--desk` | `oklch(92% 0.012 68)` | Page background (felt desk) |
| `--desk-2` | `oklch(89% 0.014 66)` | Rail background |
| `--paper` | `oklch(98% 0.006 75)` | Card surface |
| `--paper-raised` | `oklch(99.2% 0.004 78)` | Capture card (top of the stack) |
| `--rule` | `oklch(82% 0.014 68)` | Hairline borders |
| `--rule-strong` | `oklch(72% 0.018 64)` | Emphasized borders |
| `--ink-1` | `oklch(23% 0.014 50)` | Primary text |
| `--ink-2` | `oklch(44% 0.015 52)` | Secondary text |
| `--ink-3` | `oklch(59% 0.013 55)` | Meta / tertiary text |
| `--accent` | `oklch(42% 0.15 24)` | Primary actions, focus, links (oxblood) |
| `--accent-ink` | `oklch(97% 0.01 40)` | Text on accent surfaces |

### Night theme
| Token | Value |
|---|---|
| `--desk` | `oklch(13.5% 0.012 50)` |
| `--desk-2` | `oklch(11% 0.011 48)` |
| `--paper` | `oklch(19% 0.015 55)` |
| `--paper-raised` | `oklch(22% 0.017 57)` |
| `--rule` | `oklch(27% 0.018 55)` |
| `--rule-strong` | `oklch(34% 0.02 55)` |
| `--ink-1` | `oklch(90% 0.012 65)` |
| `--ink-2` | `oklch(67% 0.016 63)` |
| `--ink-3` | `oklch(47% 0.014 58)` |
| `--accent` | `oklch(73% 0.13 68)` (brass lamp light) |
| `--accent-ink` | `oklch(14% 0.02 50)` |

### Type inks (both themes swap for contrast, same hue family)
| Type | Day | Night |
|---|---|---|
| IDEA (ochre) | `oklch(50% 0.13 75)` | `oklch(76% 0.14 78)` |
| PLAN (indigo) | `oklch(40% 0.10 262)` | `oklch(70% 0.10 255)` |
| TASK (brick) | `oklch(47% 0.16 26)` | `oklch(67% 0.16 26)` |
| NOTE (graphite) | `oklch(38% 0.012 258)` | `oklch(60% 0.02 63)` |
| DONE (moss) | `oklch(45% 0.08 138)` | `oklch(64% 0.10 138)` |

## Typography

Three roles, no web fonts (offline/desktop-safe):

- **Serif** (card content, headings): `Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', serif`
- **UI sans** (chrome, buttons, nav): `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`
- **Mono** (catalog numbers, badges, timestamps, shortcuts): `ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Consolas, 'SF Mono', monospace`

Scale (~1.2 ratio): 11 / 13 / 15 / 16 / 19 / 24 / 32px. Base body 15px.

## Elevation & Radius

Paper, not plastic: radius 3px everywhere (cards, buttons, inputs). Shadows are soft and warm, never a generic drop shadow: `0 1px 2px oklch(30% 0.02 50 / .08), 0 6px 16px oklch(30% 0.02 50 / .10)`. The capture area sits on two faint stacked-card shadows behind it to suggest a physical stack.

## Components

- **Type badge**: bordered rectangle, mono uppercase, ink-colored text and border at reduced opacity, fixed -2deg rotation (rubber-stamp feel). Not a filled pill.
- **Catalog number**: `No. 037` style, mono, `--ink-3`, bottom-right of each card.
- **Card rotation**: each catalog card gets a deterministic tiny rotation (-0.6deg to 0.6deg based on its id) for a hand-filed feel. Removed on hover (card lifts flat + translateY).
- **Rail tabs**: collections shown as horizontal tabs with a small color-chip (not a border stripe), not a bulleted nav list.
- **Toggle**: Day/Night switch in the rail header, sun/moon glyphs, persisted to localStorage, defaults to system `prefers-color-scheme`.

## Motion

150-220ms, `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo family). No bounce. Cards fade+settle in on add. Theme switch cross-fades token values via CSS transition on `color`/`background-color` only.

## Layout

Two-region shell: fixed-width rail (232px) + fluid desk. No marketing/landing route: the app opens directly into the workspace. First-run (no notes, no local storage key) shows an empty catalog-drawer state in place of the notes grid instead of a separate page.
