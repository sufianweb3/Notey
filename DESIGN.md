---
version: alpha
name: Notey design system
description: "Calm, precise and quiet, in the spirit of Apple's own apps. A daily tool for one person, used for hours at a time. Warm off-white paper, charcoal ink and one lime signal. Light and dark follow the OS. Lime is never text on light surfaces; it marks progress, today, selection highlights and the brand mark."
colors:
  primary: "#1C1C1E"              # charcoal: primary button, focus ring, selected nav. 16.2:1 on surface
  on-primary: "#FAFAF7"
  primary-hover: "#2E2E31"
  accent: "#C6F135"               # lime signal: checked task, Today badge, progress, brand mark, highlight. Fill only on light
  on-accent: "#1C1C1E"            # 13.0:1 on lime
  accent-hover: "#B6E21F"
  accent-ink: "#4A6600"           # lime-family text on light surfaces when lime must read as text. 6.3:1 on surface
  accent-wash: "#EEF8C8"          # selection and highlight background
  neutral: "#F3F3EF"              # app background behind panes (sidebar sits here)
  surface: "#FAFAF7"              # content pane, page background. NOT pure white
  surface-raised: "#FFFFFE"       # cards, popovers, inputs
  on-surface: "#1C1C1E"           # body text. 16.2:1 on surface, 15.3:1 on neutral
  on-surface-muted: "#5C5C57"     # secondary text. 6.4:1 on surface, 6.0:1 on neutral
  on-surface-subtle: "#6E6E68"    # meta, placeholders. 4.9:1 on surface, 4.6:1 on neutral
  border: "#E6E6E0"               # hairline, decorative only
  border-strong: "#8A8A83"        # control boundaries, unchecked checkbox. 3.3:1 on surface
  error: "#B42318"                # 6.3:1 on surface
  on-error: "#FFFFFE"
  success: "#4A6600"              # same as accent-ink, always with an icon
  warning: "#9A5B00"              # 5.2:1 on surface
  primary-dark: "#C6F135"         # in dark mode the primary action becomes lime. 14.1:1 on surface-dark
  on-primary-dark: "#141415"
  neutral-dark: "#101011"
  surface-dark: "#141415"
  surface-raised-dark: "#1C1C1E"  # raised surfaces get LIGHTER in dark mode
  surface-overlay-dark: "#232325"
  on-surface-dark: "#EDEDE8"      # 15.7:1 on surface-dark
  on-surface-muted-dark: "#A3A39C" # 7.3:1 on surface-dark, 6.2:1 on overlay
  on-surface-subtle-dark: "#8C8C86" # 5.0:1 on raised-dark
  border-dark: "#2C2C2F"
  border-strong-dark: "#6F6F6A"
  error-dark: "#F2736A"           # 6.0:1 on raised-dark
  warning-dark: "#E6B450"
typography:
  display: { fontFamily: Inter, fontSize: 32px, fontWeight: 600, lineHeight: 1.15, letterSpacing: -0.025em }
  page-title: { fontFamily: Inter, fontSize: 30px, fontWeight: 600, lineHeight: 1.2, letterSpacing: -0.02em }
  h1: { fontFamily: Inter, fontSize: 24px, fontWeight: 600, lineHeight: 1.3, letterSpacing: -0.015em }
  h2: { fontFamily: Inter, fontSize: 20px, fontWeight: 600, lineHeight: 1.35, letterSpacing: -0.01em }
  h3: { fontFamily: Inter, fontSize: 17px, fontWeight: 600, lineHeight: 1.4 }
  body-doc: { fontFamily: Inter, fontSize: 16px, fontWeight: 400, lineHeight: 1.65 }
  body: { fontFamily: Inter, fontSize: 14px, fontWeight: 400, lineHeight: 1.5 }
  label: { fontFamily: Inter, fontSize: 13px, fontWeight: 500, lineHeight: 1.35 }
  meta: { fontFamily: Inter, fontSize: 12px, fontWeight: 400, lineHeight: 1.35 }
  numeric: { fontFamily: Inter, fontSize: 14px, fontWeight: 400, lineHeight: 1.5, fontFeature: "\"tnum\" 1" }
  mono: { fontFamily: "JetBrains Mono", fontSize: 13px, fontWeight: 400, lineHeight: 1.55 }
rounded:
  none: 0px
  sm: 6px      # chips, checkboxes, inline code
  md: 8px      # buttons, inputs, nav items
  lg: 12px     # cards, popovers, blocks (image, chart, canvas embed)
  xl: 16px     # dialogs, sheets, command menu
  full: 9999px # avatars, toggle, pill counters
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "5": 20px
  "6": 24px
  "8": 32px
  "10": 40px
  "12": 48px
  "16": 64px
components:
  page: { backgroundColor: "{colors.surface}", textColor: "{colors.on-surface}", typography: "{typography.body}" }
  sidebar: { backgroundColor: "{colors.neutral}", textColor: "{colors.on-surface}", typography: "{typography.body}" }
  nav-item: { backgroundColor: "{colors.neutral}", textColor: "{colors.on-surface}", typography: "{typography.body}", rounded: "{rounded.md}", padding: 6px 8px, height: 30px }
  nav-item-selected: { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", rounded: "{rounded.md}" }
  button-primary: { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", typography: "{typography.label}", rounded: "{rounded.md}", padding: 8px 14px, height: 34px }
  button-primary-hover: { backgroundColor: "{colors.primary-hover}", textColor: "{colors.on-primary}" }
  button-secondary: { backgroundColor: "{colors.surface-raised}", textColor: "{colors.on-surface}", typography: "{typography.label}", rounded: "{rounded.md}", padding: 8px 14px, height: 34px }
  button-ghost: { backgroundColor: "{colors.surface}", textColor: "{colors.on-surface-muted}", typography: "{typography.label}", rounded: "{rounded.md}", padding: 6px 10px, height: 30px }
  button-destructive: { backgroundColor: "{colors.error}", textColor: "{colors.on-error}", typography: "{typography.label}", rounded: "{rounded.md}", padding: 8px 14px, height: 34px }
  input: { backgroundColor: "{colors.surface-raised}", textColor: "{colors.on-surface}", typography: "{typography.body}", rounded: "{rounded.md}", padding: 8px 12px, height: 36px }
  card: { backgroundColor: "{colors.surface-raised}", textColor: "{colors.on-surface}", rounded: "{rounded.lg}", padding: 12px 14px }
  card-signal: { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", rounded: "{rounded.lg}", padding: 12px 14px }
  badge-today: { backgroundColor: "{colors.accent}", textColor: "{colors.on-accent}", typography: "{typography.meta}", rounded: "{rounded.sm}", padding: 0px 6px }
  checkbox-checked: { backgroundColor: "{colors.accent}", textColor: "{colors.on-accent}", rounded: "{rounded.full}" }
  highlight: { backgroundColor: "{colors.accent-wash}", textColor: "{colors.on-surface}" }
  link: { backgroundColor: "{colors.surface}", textColor: "{colors.on-surface}", typography: "{typography.body-doc}" }
  text-muted: { backgroundColor: "{colors.surface}", textColor: "{colors.on-surface-muted}", typography: "{typography.body}" }
  text-subtle: { backgroundColor: "{colors.surface}", textColor: "{colors.on-surface-subtle}", typography: "{typography.meta}" }
  accent-text: { backgroundColor: "{colors.surface}", textColor: "{colors.accent-ink}", typography: "{typography.label}" }
  status-warning: { backgroundColor: "{colors.surface}", textColor: "{colors.warning}", typography: "{typography.meta}" }
  dialog: { backgroundColor: "{colors.surface-raised}", textColor: "{colors.on-surface}", rounded: "{rounded.xl}", padding: 24px }
  command-menu: { backgroundColor: "{colors.surface-raised}", textColor: "{colors.on-surface}", rounded: "{rounded.xl}", padding: 8px }
  code: { backgroundColor: "{colors.neutral}", textColor: "{colors.on-surface}", typography: "{typography.mono}", rounded: "{rounded.sm}", padding: 2px 6px }
  table-numeric: { backgroundColor: "{colors.surface}", textColor: "{colors.on-surface}", typography: "{typography.numeric}" }
  page-dark: { backgroundColor: "{colors.surface-dark}", textColor: "{colors.on-surface-dark}", typography: "{typography.body}" }
  sidebar-dark: { backgroundColor: "{colors.neutral-dark}", textColor: "{colors.on-surface-dark}" }
  card-dark: { backgroundColor: "{colors.surface-raised-dark}", textColor: "{colors.on-surface-dark}", rounded: "{rounded.lg}", padding: 12px 14px }
  popover-dark: { backgroundColor: "{colors.surface-overlay-dark}", textColor: "{colors.on-surface-dark}", rounded: "{rounded.lg}" }
  text-muted-dark: { backgroundColor: "{colors.surface-dark}", textColor: "{colors.on-surface-muted-dark}", typography: "{typography.body}" }
  text-subtle-dark: { backgroundColor: "{colors.surface-raised-dark}", textColor: "{colors.on-surface-subtle-dark}", typography: "{typography.meta}" }
  button-primary-dark: { backgroundColor: "{colors.primary-dark}", textColor: "{colors.on-primary-dark}", typography: "{typography.label}", rounded: "{rounded.md}", padding: 8px 14px, height: 34px }
  error-text-dark: { backgroundColor: "{colors.surface-raised-dark}", textColor: "{colors.error-dark}", typography: "{typography.meta}" }
  warning-text-dark: { backgroundColor: "{colors.surface-raised-dark}", textColor: "{colors.warning-dark}", typography: "{typography.meta}" }
---

# Notey DESIGN.md

<!-- Source of truth for how Notey looks and behaves. Agents: read this before any UI work and update it in the same change when a decision changes. Tokens in the front matter are normative and override ui-ux-craft skill defaults.
Validate: npx @google/design.md lint DESIGN.md
Export:   npx @google/design.md export --format css-tailwind DESIGN.md -->

## Overview

Notey is a daily, all-day tool for one person: docs, tasks, whiteboards and mindmaps. It should feel like **Apple Notes and Things grew up together**. It's calm, precise and quiet, with the content doing the talking. Density is medium: comfortable in docs, tighter in the sidebar and task lists. It runs as a web app on desktop and as an installable PWA on phones.

**Forces this design resolves**
- Many features (4 page types, tasks, pins, AI) without Notion's clutter. Each screen shows one job, and tools appear on hover or `/`.
- Hours of reading and writing. A warm off-white page, never pure white, and a 16 px / 1.65 doc body at a 720 px measure.
- Lime is loud and fails contrast as text on light. It is a **signal fill**, never text and never on large areas.
- AI and agents edit content. Every machine change is visible, previewable and undoable.
- Three hosts, one look. No platform-specific UI.

**Key characteristics**
- Charcoal is the action color (primary buttons, selected nav, focus) in light mode. Lime takes that role in dark mode.
- Lime marks **progress and now**: checked tasks, the Today badge, the active progress bar, the brand mark, the AI "applied" flash.
- Structure comes from spacing and two surface steps (`neutral` sidebar, `surface` page), not borders.
- Hover reveals tools (drag handles, + buttons, row actions). Nothing is hover-only on touch.
- Signature element: **the lime check**. Completing a task fills the circle with lime and draws a charcoal tick. It's the one moment of delight, repeated daily.

## Colors

- **Primary** (`{colors.primary}`, charcoal): one primary button per view, the selected nav item, the focus ring. In dark mode `{colors.primary-dark}` (lime) takes this role.
- **Accent** (`{colors.accent}`, lime): fill only on light surfaces, always with `{colors.on-accent}` text. Used for checked checkboxes, the Today count badge, progress fills, the brand mark and the highlight swatch. Never for links, never for body text, never as a page or card background larger than a badge or a single signal card.
- **Accent ink** (`{colors.accent-ink}`): when lime meaning must appear as text on light surfaces ("4 of 7 done", success status). 6.3:1.
- **Accent wash** (`{colors.accent-wash}`): text selection, the highlight mark, the drop target while dragging.
- **Surfaces:** `neutral` (sidebar and app frame), `surface` (page), `surface-raised` (cards, inputs, popovers). Off-white, never `#FFFFFF`.
- **Text:** `on-surface` (body), `on-surface-muted` (secondary), `on-surface-subtle` (meta, placeholders). All pass 4.5:1 on every light surface.
- **Status:** error, warning and success always come with an icon or a word. Never color alone.
- **Links in docs:** `on-surface` with a 1 px underline at `border-strong`. Hover thickens the underline. No blue.
- **Text colors in the editor** (user-applied): gray, olive (`accent-ink`), amber (`warning`), red (`error`). Background highlights: `accent-wash` and a neutral gray wash. That's it.
- **Charts:** charcoal, `on-surface-muted`, `border-strong` and lime for the highlighted series. Max 4 series. Pie charts use charcoal shades plus lime for one slice. With no highlight, a fourth series takes the lime; a pie with no highlight lights its largest slice.
- **Theme:** System (default) / Light / Dark. Increased contrast (`prefers-contrast: more`): borders move to `border-strong`, muted text moves to `on-surface`.
- **Gradients:** none. Glass: only the mobile bottom tab bar and the collapsed-sidebar peek panel may use `backdrop-filter`. Solid under `prefers-reduced-transparency`.

## Typography

Inter Variable for UI and docs (open, close to SF Pro in feel). JetBrains Mono for code. Enable `font-feature-settings: "cv11", "ss03"` for a cleaner Inter look, and `tnum` in tables, task counts and dates.

| Token | Size | Weight | Line height | Tracking | Use |
|---|---|---|---|---|---|
| display | 32 | 600 | 1.15 | -0.025em | Home greeting only |
| page-title | 30 | 600 | 1.2 | -0.02em | Page titles in the editor |
| h1 / h2 / h3 | 24 / 20 / 17 | 600 | 1.3 to 1.4 | slight negative | Doc headings |
| body-doc | 16 | 400 | 1.65 | 0 | Doc body (also 16 px on inputs to avoid iOS zoom) |
| body | 14 | 400 | 1.5 | 0 | UI body, sidebar, task rows |
| label | 13 | 500 | 1.35 | 0 | Buttons, section labels |
| meta | 12 | 400 | 1.35 | 0 | Timestamps, counts, hints |
| mono | 13 | 400 | 1.55 | 0 | Code blocks, inline code, tokens |

Principles: at most 3 sizes in any one UI region. Weights 400 / 500 / 600 only. Doc measure is 720 px max (about 70 characters). Sentence case everywhere. Numerals in the UI ("3 tasks", not "three tasks").

## Layout

- 4 px base, scale values only. Space inside a group is smaller than space between groups.
- **App shell (expanded, 840 px and up):**

```
┌──────────────┬──────────────────────────────────────────────┬────────────┐
│ Sidebar 248  │ Top bar 44: breadcrumb · pin · ··· · AI      │ AI panel   │
│ (neutral)    ├──────────────────────────────────────────────┤ 380, opt.  │
│ Workspace ▾  │                                              │ (⌘J)       │
│ Search ⌘K    │      Page content, max 720 (docs)            │            │
│ Home         │      full bleed (canvas, mindmap)            │            │
│ Important    │      max 960 (tasks, home)                   │            │
│ Tasks    (4) │                                              │            │
│ ─ Projects ─ │                                              │            │
│ ▸ Project    │                                              │            │
│ ⋮            │                                              │            │
│ Trash · ⚙    │                                              │            │
└──────────────┴──────────────────────────────────────────────┴────────────┘
```

- **Sidebar collapse:** `⌘\` or the toggle collapses the sidebar to a 52 px **icon rail** (workspace mark, Search, Home, Important, Tasks, Projects, Settings). Hovering the rail for 300 ms, or pressing the Projects icon, opens a **peek panel** over the content. The state is remembered per device. Width is resizable from 200 to 360 px by dragging the edge.
- **Breakpoints**

| Name | Width | Layout |
|---|---|---|
| compact | under 600 | No sidebar. Bottom tab bar (Home, Important, Tasks, Search, +). Sheets instead of popovers. 16 px margins |
| medium | 600 to 839 | Icon rail by default, peek panel for the tree. 24 px margins |
| expanded | 840 to 1199 | Full sidebar. AI panel overlays the content |
| large | 1200 and up | Full sidebar. AI panel docks beside the content |

- Touch targets are at least 44 x 44 on touch and 24 x 24 with a pointer. Use `100dvh` shells, `viewport-fit=cover` and safe-area insets for the tab bar. Never disable zoom.

### Screens

**Home** (content max 960)
```
Monday, 23 November                          (meta, muted)
Good morning                                 (display)

Pinned                                  See all
[ Doc card ][ Canvas card ][ Signal card: Launch checklist 3 of 8 ]

Today                                   4 left
( ) Send Fevgo homepage draft           10:00
( ) Review bot logs                     ↻ Daily
(✓) Renew domain                        (struck, subtle)

Recent
Fevgo brief · Edited by Claude · 2h ago
```

**Tasks**
```
Tasks   [Inbox] [Today] [Upcoming] [Project ▾]        List | Board
+ Add a task  (natural language: "Pay rent every month on 1st")
──────────────────────────────────────────────
Overdue
( ) Invoice CRG Attire            Yesterday   ⋯
Today
( ) Call Rafi                     15:00       ⋯
```
Rows are 36 px, separated by hairlines (not cards). Hover shows the row actions (date, pin, more). Clicking the title edits it inline. Clicking empty row space opens a detail **sheet** from the right (notes, repeat, project, status).

**Doc**
```
Fevgo / Website / Homepage brief                ☆  ⋯   ✦ AI
                                    
   📄  Homepage brief               (icon optional, page-title)
   Edited by Claude · 2h ago        (meta, only after an agent edit)

   Body text at 16/1.65, max 720…
   ⠿ +   (drag handle and + appear left of the hovered block)
```

**Important:** sections for Pages, Tasks, Folders and Projects. Cards for pages, rows for tasks. Drag to reorder. Empty state: "Pin anything with ☆ to keep it here."

**Canvas / Mindmap:** full-bleed. The top bar stays, with a one-line title row under it. Paper `surface`, ink `on-surface`, grid dots at `border`.

- **Canvas** keeps Excalidraw's own toolbar (top centre, bottom on phones), re-skinned with tokens in `src/web/components/canvas/canvas.css`: islands `surface-raised`, menus `surface-overlay`, hover `neutral`, borders `border`, selected tool `accent-wash`, primary `primary`, UI font Inter. Excalidraw's hand-drawn fonts stay for drawings. Scene colours are document data, stored as literals (`SCENE` in `src/web/lib/excalidraw.ts`) and inverted by Excalidraw in dark mode. A sticky note is a borderless `accent-wash` rectangle with ink text, added from the button at the top right. Excalidraw's promo and social menu items are hidden.
- **Mindmap** has a floating toolbar at the bottom centre: add inside, add next, remove, layout (Left to right / Radial; one icon below 600 px), fit. Central idea: `primary` fill, `on-primary` text, `radius-lg`. First ring: `surface-raised` with a `border` ring. Deeper ideas: text on `surface`. Selected: the focus ring. Drop target while dragging: `accent-wash`. Edges `border-strong` at 1.5 px. Fold buttons sit on the node's outer edge and show how many ideas they hide.
- **Embeds in docs:** a card (level 1) with the page's icon, title and "Open canvas" / "Open mindmap", over a read-only picture of it. Clicking opens the page.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 | flat, grouped by spacing | page, sidebar |
| 1 | `surface-raised` + 1 px inset ring `border` | cards, blocks, inputs |
| 2 | ring + shadow-2 | menus, popovers, `/` menu, hover cards |
| 3 | ring + shadow-3 + scrim | command menu, dialogs, task sheet on compact |

### Shadow tokens
| Token | Value (light) | Use |
|---|---|---|
| shadow-2 | `0 1px 2px rgb(28 28 30 / 0.05), 0 6px 16px rgb(28 28 30 / 0.08)` | popovers, menus |
| shadow-3 | `0 2px 4px rgb(28 28 30 / 0.05), 0 12px 28px rgb(28 28 30 / 0.10), 0 32px 64px rgb(28 28 30 / 0.12)` | command menu, dialogs |
| scrim | `rgb(16 16 17 / 0.28)` | behind dialogs and sheets |

Dark mode: no shadows. Use the lighter surface steps (`surface-raised-dark`, `surface-overlay-dark`) and `border-dark` hairlines. Never combine a border, a heavy shadow and a background shift on one element.

## Shapes

Radius: sm 6, md 8, lg 12, xl 16, full. Nested radius = outer radius minus padding. Buttons are rounded rectangles (md), never pills, except the mobile + button and the floating "New" pill on the board. No radius above lg on dense lists.

Icons: **Lucide**, 1.5 px stroke, 16 px in the sidebar and rows, 18 px in the top bar. Outline at rest. The selected nav icon inherits `on-primary`. The pin star fills with `on-surface` when pinned. No emoji as UI icons (users may pick emoji as page icons).

## Components

Build on **Radix primitives** (dialog, popover, dropdown, context menu, tooltip, toggle group) styled with Tailwind v4 and these tokens. Toasts use **Sonner**.

- **Button:** primary / secondary / ghost / destructive. Label is verb + object ("New page", "Create token"). Press `scale(0.97)`. Loading keeps the width. Never disabled without a reason shown in a tooltip.
- **Nav item:** 30 px tall, icon + label + optional count. Selected = `nav-item-selected`. Hover = `border` wash. Count badge: muted text, except Tasks' Today count, which uses `badge-today`.
- **Tree row:** chevron (rotates 90°), icon, title (truncates with a tooltip), hover actions `+` and `⋯`. Drag shows a 2 px charcoal insertion line, and nesting shows an `accent-wash` target.
- **Checkbox (task):** 16 px circle with a 1.5 px `border-strong` ring. Checked: fills `accent`, draws the tick in `on-accent` over 220 ms, then the title strikes and fades to `on-surface-subtle`. The row leaves the list after 1.2 s, with undo in a toast.
- **Card (pinned / recent):** `card` token, icon, title (2 lines max), meta line. The signal variant (`card-signal`) is reserved for one task-progress card on Home.
- **Command menu (`⌘K`):** 640 px wide, top third of the screen, input at 16 px, grouped results (Pages, Tasks, Commands), arrow keys + Enter, `⌘Enter` opens in a new tab.
- **`/` menu:** 320 px popover, filter as you type, groups (Basic, Media, Advanced, AI), keyboard first.
- **Task sheet:** right sheet 420 px (bottom sheet on compact) with the title, notes, status segmented control, due date, repeat and project.
- **AI panel:** 380 px. Header lists **grants** as removable chips ("This page", "@Pricing notes"). Messages render in the doc typography. The composer has an @ picker and a model picker.
- **AI preview:** inline diff block. Removed text gets a strikethrough with an `error` tint, added text gets an `accent-wash` background. A bar offers **Accept** (primary), **Discard** and **Retry**.
- **Agent edit banner:** "Claude edited this page" with Reload and Keep mine. Uses `surface-raised`, an info icon and no color fill.
- **Empty states:** what this is, plus one action. "No tasks for today. Add one with T."
- **Toast:** bottom center, 400 ms enter. Actionable toasts (Undo) stay 6 s.

Every component ships all states: default, hover, active, focus-visible, disabled-with-reason, loading, selected, error. Every data view ships ideal, empty, loading (skeletons after 300 ms only), partial and error.

## Do's and Don'ts

- Do keep lime to small signal areas. If you need more than a badge, use charcoal.
- Do let the page breathe. Docs are 720 px max with generous top padding (64 px).
- Do show tools on hover with pointer, and keep them always visible (or behind ⋯) on touch.
- Do mark every machine edit ("Edited by Claude") and keep undo one step away.
- Don't use lime for text, links or large backgrounds on light surfaces.
- Don't use pure white `#FFFFFF` or pure black `#000000`.
- Don't add borders where a surface step or spacing works.
- Don't put cards inside cards, or use rainbow pastel cards.
- Don't add a second accent color, gradients, glow or decorative illustrations.
- Don't animate keyboard-driven actions (command menu filtering, list navigation).

## Motion

Uses Motion (Framer Motion) springs for drag and sheets, and CSS transitions for everything else. Follows Emil Kowalski's and Apple's guidance.

| Token | Value | Use |
|---|---|---|
| ease-out | cubic-bezier(0.23, 1, 0.32, 1) | enter/exit default |
| ease-in-out | cubic-bezier(0.77, 0, 0.175, 1) | on-screen movement |
| ease-drawer | cubic-bezier(0.32, 0.72, 0, 1) | sheets, sidebar collapse |
| press | 160 ms | `:active` scale 0.97 |
| micro | 120 to 180 ms | hover, toggles |
| popover | 180 ms | from trigger origin, scale 0.96 + opacity |
| dialog / command menu | 200 ms | scale 0.97 + opacity, scrim fades 150 ms |
| sidebar collapse | 260 ms | ease-drawer, width + content fade |
| sheet | 320 ms | ease-drawer, interruptible, drag to dismiss |
| check | 220 ms | lime fill + tick draw (signature) |
| toast | 400 ms in, 200 ms out | |

Rules: no animation on `⌘K` open via keyboard after the first time in a session (instant). No animation on list navigation or typing. Transform and opacity only. Exits faster than entrances. Reduced motion: replace movement with opacity fades and keep the check fill (as an instant color change).

## Accessibility

- WCAG 2.2 AA. All documented pairs were checked (ratios in front matter comments).
- Focus ring: 2 px solid `primary` (lime in dark), 2 px offset, via `outline`. Never hidden by the sticky top bar.
- Keyboard map:

| Keys | Action |
|---|---|
| `⌘K` | Command menu / search |
| `⌘N` / `T` | New page / quick add task |
| `⌘\` | Toggle sidebar |
| `⌘J` | Toggle AI panel |
| `⌘⇧P` | Pin / unpin |
| `⌘1` to `⌘9` | Switch workspace |
| `↑ ↓` `Enter` `Esc` | Lists, tree and menus (roving tabindex, one tab stop per widget) |
| `?` | Shortcut sheet |

- Tree uses the ARIA tree pattern. Task lists use list semantics, with the checkbox named "Complete: <task title>".
- Targets: 24 px minimum on pointer, 44 px on touch. Honors reduced motion, reduced transparency, increased contrast, forced colors and 200% text.
- Canvas: Excalidraw's keyboard support, plus a text alternative (element list) via "Describe canvas" in the ⋯ menu.

## Voice & Copy

Sentence case. Buttons are verb + object. No "please", no "Oops", no exclamation marks. Errors say what happened and how to fix it: "Couldn't save. Check your connection and try again." Terms: workspace, project, folder, page, task, pin, Important, Trash, token. Never "note" and "doc" for the same thing: the page type is **Doc**, and a "note" is just how users talk. Fixtures use realistic, diverse names (Rafi, Nadia, Mei, Tomás) and real-looking work, never lorem ipsum.

## AI states

AI marker: Lucide `sparkle` (one, consistent) always paired with a verb ("Ask AI", "Summarize"). States:

| State | Treatment |
|---|---|
| idle | Marker in the top bar, muted |
| thinking | Three-dot pulse in `on-surface-muted` + Stop |
| streaming | Text appears in the preview block + Stop |
| preview | Diff with Accept / Discard / Retry |
| applied | 600 ms `accent-wash` flash on the changed blocks, then "Undo AI edit" in a toast |
| error | Inline message, prompt kept, Retry |
| cancelled | Partial output kept in the preview |

No gradients or glow for AI. Under reduced motion, the pulse becomes static text ("Thinking…").

## Iteration Guide

1. Change one component at a time and reference tokens by name, never raw hex or px.
2. A new state is a new sibling key (`-hover`, `-selected`).
3. Before adding chrome, try spacing, then a surface step.
4. For a new screen, sketch 2 named directions and pick one before building.
5. Update this file in the same commit as the code and run the linter.

## Known Gaps

- No increased-contrast palette values yet beyond the border/text rules above.
- App icon and favicon not designed yet (start: charcoal rounded square, lime "N").
- Print stylesheet for PDF export to be defined in M6.
- Editor colour picker maps BlockNote's colour names to the four allowed text colours (gray, green → olive `accent-ink`, orange → amber `warning`, red → `error`) and two highlights (yellow → `accent-wash`, gray wash). The mapping lives in `src/web/components/editor/editor.css`.
- Inline equations are edited through a native prompt for now; a proper inline popover is still to design.
- Inter and JetBrains Mono are not bundled yet (licence question in PRD §14), so the system font shows.
