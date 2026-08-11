# Changelog

All notable changes to TaskMaster Obsidian plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.3] - 2026-08-12

### Fixed

- Timer banners no longer clip work plans after the fifth row; all configured steps are visible.
- Task changes made through Obsidian's native Properties panel or external file automation now
  emit task update events, immediately refreshing active timer plans and `currentStep` markers.

## [0.5.2] - 2026-08-12

### Changed

- Work-plan storage now uses separate scalar frontmatter properties (`step1`, `step2`, ...),
  so Obsidian's native Properties panel provides one text input per numbered step instead of
  rendering the whole plan as array chips.
- Legacy `steps` arrays remain readable and migrate to numbered properties on the next write.

## [0.5.1] - 2026-08-12

### Changed

- Work plans in the task create/edit forms use individually numbered rows (`Step 1`, `Step 2`,
  and so on) with add/remove controls instead of one multi-line field.
- Every work-plan row in a timer banner is clickable. Clicking a row persists that position to
  `currentStep`, so manual selection and external automation share the same progress state.

## [0.5.0] - 2026-08-12

### Added

- Task create/edit forms now accept a multi-line work plan. Numbered or bulleted pasted lines
  are normalized into the machine-readable `steps` frontmatter list.
- Timer banners show the plan below elapsed time, with completed, current, and pending states.
- The 1-based `currentStep` frontmatter field can be updated by external automation while a
  timer is active; the banner refreshes immediately. The edit form also exposes a step picker.

## [0.4.1] - 2026-08-11

### Fixed

- Jira sync no longer wipes locally recorded `actualMd` (e.g., from the T-901 timer) when
  the Jira Actual MD field is empty. When Jira has a value, it still wins as before.

## [0.4.0] - 2026-08-11

T-901 follow-up: macOS menu bar timer, alongside the in-window banners.

### Added

- macOS menu bar (Tray) timer display via `@electron/remote` (same access path as the
  obsidian-tray community plugin): stopwatch template icon + live elapsed text
  (`▶ 25:31`, `⏸ 04:10 +2`), visible even when Obsidian is in the background.
- Clicking the icon opens a per-task menu with Start/Pause(Resume)/Stop(→DONE + actualMd).
- Swipe-dismissed banners stay listed in the menu bar with a "Show banner again" action
  (`TaskTimerService.restore`).
- Graceful degradation: on mobile or if Electron remote is unavailable, the menu bar
  feature silently disables itself; banners are unaffected. Tray is destroyed on unload.
- Spec coverage: `tests/ui/timer/TimerMenuBar.test.ts` (M1–M8) with an injected fake tray port.

## [0.3.0] - 2026-08-10

T-901: DOING timer notification banners (task_01KZN31H).

### Added

- macOS-notification-style timer banners: moving a task to DOING shows a rectangular banner
  stacked at the top-right of the Obsidian window (newest on top), independent of the
  TaskMaster view (`mountTimerOverlay` on `document.body`).
- Per-task stopwatch with Start / Pause(Resume) / Stop buttons. Stop moves the task to DONE
  and records tracked time into `actualMd` (1 MD = 8h, rounded to 2 decimals, min 0.01,
  summed onto any existing value).
- Swipe-right to dismiss a banner (≥80px); tracking continues in the background.
- Timer state persists to `TaskMaster/.timers.json` and restores across Obsidian restarts,
  including wall-clock time elapsed while closed (running timers) and frozen totals (paused).
- Spec coverage: `tests/services/TaskTimerService.test.ts` (R1–R22),
  `tests/ui/timer/TimerNotificationStack.test.tsx` (U1–U10),
  manual checklist `tests/manual/timer-notifications.md`.

## [0.2.0] - 2026-05-11

Phase 2: usability hardening and project quick memo workspace.

### Added

- Project context header with `Open memo`, `New meeting`, quick memo composer, and recent memo preview.
- Quick memo append to `## Quick Notes` grouped by `### YYYY-MM-DD`, with `^tm-memo-<ULID>` Obsidian block IDs.
- Quick memo actions: create task with source memo link, promote to standalone note under `TaskMaster/ProjectMemos/`, and copy memo block link.
- Default project note template: Goal, Current Status, Decisions, References, Quick Notes.
- Archive view with restore/delete actions.
- Search by title/body summary/Jira key and priority filter.
- Desktop card action menu and edit modal for title, priority, and project.
- Keyboard reorder with `Cmd/Ctrl + ArrowUp/ArrowDown`.
- Inline plain-text body summary on cards.
- Project-linked meeting note creation with Action Items section.
- Wikilink helper shared across memo/task/meeting workflows.

### Changed

- Filtered board reorder now preserves hidden task IDs.
- Settings changes update live where possible; locale and debounce clearly require reload.
- DiagnosticsLog now feeds the visible Settings diagnostics pane.
- Project quick memo storage policy documented in ADR-0011.
- README, PRD, HLD, mobile QA, a11y QA, and project memo QA updated for Phase 2.

### Fixed

- Desktop card menu actions no longer trigger card open or drag.
- Rapid quick memo appends for the same project are serialized to avoid lost notes.
- Stale project memo writes create conflicted copies instead of overwriting external edits.

### Test coverage

- 227 automated tests across 34 files.
- `npm test`, `npm run typecheck`, and `npm run lint` pass.
- Manual QA checklists include project memo desktop/mobile/conflict scenarios.

## [0.1.0] - 2026-05-10

Initial Phase 1 release. Architecture validation milestone.

### Added

- **TaskMaster Kanban view** with Todo / Doing / Done columns, openable via ribbon icon and command palette.
- **Markdown-as-source-of-truth** for tasks, meetings, and projects. Every entity is a `.md` file in `[Vault]/TaskMaster/`.
- **Drag and drop** between columns and within a column on desktop / tablet (dnd-kit with PointerSensor 5px constraint).
- **Mobile experience** with status tabs and explicit "next status" / "previous status" buttons (no dnd; see ADR-0009).
- **Keyboard navigation**: Tab focus, `Enter` to open note, `Cmd/Ctrl+Enter` to advance status, `Cmd/Ctrl+E` to archive, `Cmd/Ctrl+Backspace` to delete with confirm.
- **Project model** with `+ New project` modal and project filter dropdown.
- **External edit aware**: file changes outside the plugin reflect in the board within ~250 ms via Obsidian's metadataCache.
- **Conflict detection** with mtime comparison + field-level merge + conflicted copy fallback.
- **Passthrough frontmatter** (ADR-0008): custom fields you add (Dataview, tags, aliases, other plugin metadata) are preserved across edits.
- **`.board.json` in vault** (ADR-0002): card visual order syncs across devices via Obsidian Sync / Git / iCloud.
- **Settings tab**: data root, save debounce, confirm-on-delete, locale.
- **Diagnostics pane**: 50 most recent parse / flush / conflict / boot events with kind-coded colors.
- **i18n**: Korean and English; follows Obsidian locale by default.
- **Accessibility**: ARIA roles + labels, focus-visible rings, color-blind friendly priority badges.

### Architecture decisions

Documented in `planning/adr/`:

- ADR-0001 hybrid storage (Markdown source-of-truth + JSON cache)
- ADR-0002 `.board.json` lives in the vault to sync across devices
- ADR-0003 ULID-based IDs with short ID auto-expansion
- ADR-0004 immediate flush for semantic data, debounce for visual data
- ADR-0005 metadataCache-first scanning (1000 tasks < 1 second)
- ADR-0006 Tailwind v3 with `tm-` prefix and Obsidian variable mapping
- ADR-0007 Zustand vanilla store (no React in services)
- ADR-0008 frontmatter passthrough policy
- ADR-0009 Phase 1 mobile uses no drag and drop
- ADR-0010 Phase 1 card click opens the Markdown note (no inline detail panel)

### Known limitations

- No LLM-based action item extraction (now planned for Phase 4).
- Large boards (>1 000 tasks) are not virtualized (Phase 5).
- Mobile dnd is intentionally disabled (Phase 5 polish).
- Inline body editing is not yet supported (Phase 2).
- Settings only allows changing debounce / confirm / locale (data root is read-only).
- Project entity has no dedicated dashboard yet (Phase 2).

### Test coverage

- 180 automated tests across 27 files
- Manual QA checklists in `tests/manual/` (a11y, lifecycle, mobile, passthrough)
