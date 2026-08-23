# Changelog

All notable changes to TaskMaster Obsidian plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - 2026-08-23

### Added

- The quick panel opens with an **AI report** section on top. TaskMaster runs a Claude Code skill
  headlessly — `claude -p "/daily-schedule-feedback" --permission-mode acceptEdits` from the vault
  root — and reads back the Markdown the skill writes, showing its newest section as a snapshot,
  bullet feedback, and a highlight line. The card is collapsed by default (highlight only) so the
  task list keeps the panel; expanding scrolls inside the card instead of pushing the tasks away.
- `↻ 리포트 받기` runs the skill on demand and shows a live elapsed counter while the process is
  alive; failures land in the card as a one-line reason (missing binary, timeout, non-zero exit)
  instead of disappearing silently. `전체 리포트 열기` opens the source Markdown in Obsidian.
- The report is scheduled inside the plugin: once a day, after the configured time, when the file
  has no section for today. The launchd job that used to do this had been dead since 2026-08-09 —
  it exits 127 because a LaunchAgent cannot read a script under `~/Desktop` without Full Disk
  Access. Obsidian already holds the vault, so the schedule now lives where the permission is.
- Settings (AI report): enable, skill prompt, report file path, `claude` executable, auto-run time
  (`HH:MM`, empty = manual only), timeout in minutes, and a "run now" button. New command:
  **Run AI report now**.

### Fixed

- Re-rendering the panel no longer scrolls the content: the step input's autofocus dragged the
  scroll container down, which pushed the new report section out of view on every open. Focus is
  now given with `preventScroll` and the scroll position is restored afterwards.

## [0.9.5] - 2026-08-23

### Added

- A global shortcut, `Control+Option+Command+T`, opens and closes the quick panel from any app.
  When the menu bar runs out of room, macOS parks a newly created status item off-screen, and the
  otter becomes unclickable; the shortcut is an entry point that does not depend on the icon.

### Changed

- Truncated titles in the quick panel — the focused task, its steps, and every next-up row — now
  scroll horizontally while the pointer rests on them, so a long title can be read to its end
  without opening the board. No scrollbar is drawn — the macOS overlay bar sat on top of the very
  text being read. One-second timer redraws keep each title's horizontal position.

### Fixed

- The quick panel now opens as a macOS non-activating panel (`NSPanel`), so clicking the otter no
  longer brings Obsidian to the front. A regular window activates its app the moment it becomes
  key, which dragged the main window along; a panel takes keyboard input while the app stays
  inactive. Electron builds that reject the panel type fall back to the previous window.
- Each renderer reload used to leave its menu bar icon behind. The tray reference kept in the
  main-process global does not survive a reload — a fresh renderer reads it back as empty — so
  every reload added an icon and the visible one was a corpse whose click handler was gone. The
  renderer now destroys its own tray on `beforeunload`/`pagehide`, before it dies.
- A status item parked off-screen reported an anchor far to the left of the display, which pinned
  the panel to the screen's left corner. Anchors outside the work area now fall back to the
  top-right default position.
- Popover and tray lifecycle events are appended to `/tmp/taskmaster-popover.log`. The panel lives
  outside the Obsidian window, so without it a failure leaves no trace unless devtools happen to
  be open.
- Clicking the otter to close its quick panel no longer pulls the Obsidian window to the front.
  When the panel was opened while Obsidian was in the background, closing it hides the app again
  and returns focus to whatever the user was working in.

## [0.9.4] - 2026-08-23

### Changed

- The transparent otter artwork now fills a 22-point macOS status item, with a tightly cropped
  44-pixel Retina representation instead of the previous 16/32-pixel pair.

### Fixed

- Clicking the otter while its quick panel is open now closes the panel. Blur dismissal waits
  briefly for the macOS `blur → Tray click` event order, so the same click cannot close and then
  immediately reopen the panel.

## [0.9.3] - 2026-08-22

### Changed

- The macOS status item now shows only the user's TaskMaster otter artwork, extracted onto a
  transparent background and tightly framed in native 1x/2x menu-bar sizes. Timer glyphs,
  elapsed text, and task counts no longer sit beside the artwork; those details live inside the
  click-opened panel.

### Fixed

- Tray ownership now lives in Electron's shared main-process registry, not only the current
  Obsidian renderer window. A new vault window or renderer replaces the previous native Tray and
  its stale click handler, keeping one clickable TaskMaster status item after future reloads.
- The quick panel now gives its app root a fixed height so the central content becomes a real
  scroll container. One-second timer redraws preserve that container's scroll position instead of
  snapping it back to the top.

## [0.9.2] - 2026-08-22

### Fixed

- macOS could return focus to Obsidian as the original status-item or command-palette click
  completed, immediately firing the new popover's blur-to-close path. The panel now lets that
  opening event settle and reacquires focus before enabling normal outside-click dismissal.
- Clicking the menu-bar status item while the previous popover's asynchronous close event was
  still in flight could also make the click appear to do nothing. Every status-item click now
  starts a fresh popover session, and a stale window can no longer tear down the replacement.
- Startup read task Markdown files sequentially, so the empty board remained visible while every
  cached-read delay accumulated. Independent task files are now read concurrently while preserving
  their stable result order and per-file error isolation.

## [0.9.1] - 2026-08-22

### Fixed

- Reloading Obsidian while TaskMaster's asynchronous vault bootstrap was still running could let
  the unloaded plugin instance resume afterward and create another menu-bar timer, quick panel,
  and overlay. Startup now carries an unload cancellation guard through indexing and timer restore.
- Native UI cleanup is isolated and the menu-bar Tray is destroyed first, so a failure while
  closing another Electron window cannot strand an additional status item.

### Changed

- TaskMaster no longer mounts the automatic timer banner over the Obsidian window. The macOS
  menu-bar quick panel is now the single default timer surface; the explicit right-click desktop
  pin remains available when an always-on-top window is wanted.

## [0.9.0] - 2026-08-22

### Added

- Clicking the macOS menu-bar icon now opens a purpose-built dark popover instead of the plain
  native text menu. It puts active timers, work-plan progress, upcoming tasks, today's completion
  count, and the full-board shortcut in one compact view attached to the status item.
- A work-plan step can be appended to any active task directly in that popover. The field keeps its
  focus and draft while one-second timer refreshes redraw the panel, then saves through the existing
  TaskService path to the task Markdown file.
- The popover can quick-create a TODO task or move an upcoming task into DOING and start its timer,
  without bringing Obsidian to the foreground.
- `Open TaskMaster quick panel` provides the same panel from Obsidian's command palette when the
  macOS status item is hidden or keyboard access is more convenient.

### Changed

- The previous native timer and display menu remains available on right-click as a fallback and for
  display-pin controls. Left-click is reserved for the quick panel.

## [0.8.2] - 2026-08-18

### Fixed

- Restoring timer state on startup could recover nothing and then immediately save over the file,
  zeroing the elapsed time and destroying the evidence needed to find out why. When the saved file
  held timers and none of them could be restored, the plugin now leaves the file untouched and
  reports the reason per timer.
- Reading `.timers.json` returned an empty list without a word when the file was missing, unreadable,
  or malformed. Each of those now says so.

## [0.8.1] - 2026-08-18

### Changed

- Jira sync no longer creates cards for epics. An epic groups other tickets rather than being work to
  do, so on a personal board it just crowds the DOING column next to the tickets it contains. The
  test is `issuetype.hierarchyLevel >= 1`, not the type name, because the name follows the Jira UI
  language and reads "에픽" on a Korean account. Sub-tasks (-1) and ordinary issues (0) are
  unaffected, and the rule applies to the by-key pass as well, so an existing epic card is not
  revived by a later sync.

## [0.8.0] - 2026-08-18

### Fixed

- Completing an issue in Jira left the local card on its old column. Two faults stacked up. The
  status name follows the Jira UI language, so a Korean account reports "완료" and the English-only
  regex fell through to `todo`; completion is now decided by `status.statusCategory.key`, which does
  not change with the language, and the name is only consulted for the in-review / hold distinction
  that the category cannot express. Korean status names are matched as well.
- The default JQL excludes completed work (`statusCategory != Done`), so an issue disappears from
  the sync results at the moment it is finished and its card is never touched again. Sync now looks
  up the local jiraKeys the query did not return and closes their status from Jira. That pass only
  updates — it never creates a task.

## [0.7.2] - 2026-08-18

### Fixed

- A task file that first became readable while the plugin was running — created outside the plugin,
  restored from git, or repaired by hand — landed in the store without being registered in the
  repository's path index. Every later save for it then failed with `Unknown task id`, was requeued,
  and repeated "failed to save changes" indefinitely. The vault create/modify handlers now register
  the path, for meetings as well as tasks.
- `.board.json` and `.timers.json` begin with a dot, so Obsidian's vault index never lists them.
  Looking them up by path always returned nothing, which sent every write down the create branch and
  failed with "File already exists" once the file existed — the board had not been persisted since
  2026-08-07 and timer state was never restored. Both now read and write through the vault adapter,
  which addresses files by path instead of going through the index.

## [0.7.1] - 2026-08-18

### Fixed

- Task fields whose value begins with a YAML flow indicator (for example a work-plan step written
  as `[AI] 계획 문서 생성`) were written unquoted, which made the whole file fail to parse. The task
  then dropped out of the index, and the next Jira sync treated its issue as unseen and created a
  duplicate task file, stranding the steps and tags the user had entered by hand. Scalars are now
  quoted whenever a parse round-trip does not return the original string.
- Jira sync now checks the task files on disk — including files it cannot parse — before creating a
  task, and reports the offending path instead of creating a duplicate.

## [0.7.0] - 2026-08-18

### Added

- The menu bar timer can now choose which display the pinned floating window opens on. With two or
  more monitors connected, a "Show timer on" submenu lists every display (Automatic follows the
  current primary display); switching moves an already-pinned window immediately. The choice is
  stored per machine, and a display that is disconnected falls back to the primary one.

## [0.6.4] - 2026-08-12

### Fixed

- Plugin startup and unpin now sweep stale TaskMaster floating windows left by older hot-reloaded
  plugin instances, so overlapping windows cannot make the unpin action appear ineffective.

## [0.6.3] - 2026-08-12

### Fixed

- Floating-window controls now use a sandbox-safe click bridge instead of relying only on
  Electron custom-protocol navigation, fixing the unpin (`×`) action on affected Obsidian builds.

## [0.6.2] - 2026-08-12

### Fixed

- The always-on-top desktop timer now accepts mouse input. Work-plan rows select the current
  step, and compact header controls start/pause, stop, or unpin directly from the floating window.

## [0.6.1] - 2026-08-12

### Added

- The macOS menu-bar menu now includes the same desktop pin/unpin toggle above the task list.

### Fixed

- Obsidian quit, reload, and plugin-disable paths checkpoint running overall/step timers before
  teardown. Recovery state is written first, then `stepNSeconds` task frontmatter is flushed.
- Menu-bar tray creation is single-instance across plugin hot reloads, preventing new duplicate
  status items from accumulating.

## [0.6.0] - 2026-08-12

### Added

- Per-step stopwatch tracking: the active work-plan step accrues time while the task timer runs.
- Switching steps manually or through an external `currentStep` edit closes the previous segment
  and starts the next one without resetting the task's overall elapsed time.
- Step durations survive restart in `.timers.json` and are persisted as numeric frontmatter
  properties (`step1Seconds`, `step2Seconds`, ...) on step change, pause, and stop.
- Timer banners show a live elapsed value beside every step.
- A pin toggle now lives directly in each task timer header. It opens a compact, always-on-top
  desktop window so task titles, current steps, and live elapsed times remain visible while
  another application is active. Unsupported mobile/web runtimes hide the toggle.

### Changed

- The current step uses Obsidian's accent-colored background for stronger visual emphasis.
- Long step labels stay within the banner using a one-line ellipsis; hovering exposes the full
  value through a tooltip.
- The desktop pin control shares the existing task timer header instead of adding a separate
  toolbar above the timer stack.

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
