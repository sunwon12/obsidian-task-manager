# Changelog

All notable changes to TaskMaster Obsidian plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Every Swift Ratko task card now opens a task-scoped AI window. It starts with that task's title,
  body, steps, current phase, and conversation as context, and can answer questions or propose
  coarse `[인간]`/`[AI]` steps, a memo append, or a body edit.
- Focus cards expose a visible `AI 단계 채우기` action; upcoming and floating cards expose the
  same task AI entry points. The model has read-only vault tools and returns JSON proposals only.
  Ratko shows the proposed changes for apply/discard, rejects stale proposals, and preserves the
  active step and measured seconds when accepted steps are renamed or reordered.
- The Swift quick panel has a visible bottom resize grip. Dragging it vertically grows or shrinks
  the task list while keeping the header and footer in place; the chosen height persists across
  panel and app reopen and is clamped to the current screen's usable height.
- Current and upcoming Swift Ratko cards can be dragged from their noninteractive card surfaces,
  including status, timer, background, and empty space. Titles, steps, inputs, and action buttons
  retain their click behavior. Cards can be reordered within either list or moved across lists;
  crossing starts or pauses the timer and changes
  `DOING`/`TODO` without losing elapsed totals or step time. Mixed-status order persists in the
  optional `.board.json` `ratkoOrder`, and Obsidian preserves the latest on-disk value before writes.

### Changed

- Work-plan steps now represent coarse measurement phases with `[인간]` and `[AI]` owner prefixes,
  so human thinking time and AI runtime can be compared. AI drafts no longer force five work kinds,
  a 3-7 step count, a decision-first order, or detailed execution instructions.

### Fixed

- Task-scoped AI buttons in the Swift menu-bar panel now activate and raise the selected task's
  AI window. `openWindow` had created the window behind the active app because Ratko runs as an
  `LSUIElement`, making the control look unresponsive. Each AI window is now identified by task id
  and explicitly made the key front window from focus, upcoming, and floating-card entry points.
- Ratko task dragging now observes the panel's AppKit mouse stream after a 5-point movement threshold,
  because SwiftUI's item-provider drag callbacks could be skipped entirely inside the menu-bar panel.
  One geometry-aware surface covers both `현재 작업` and `다음 할 일`; the pointer's position relative
  to each card midpoint selects one purple insertion boundary, the dragged card dims, and mouse-up commits
  and persists the move. A normal click still reaches the original title, input, and action controls.
- Dragging a Ratko task near the top or bottom of the scroll viewport now smoothly auto-scrolls long
  lists. The panel resolves SwiftUI's actual nested `NSScrollView` instead of relying on a missing
  enclosing view, and uses one 60 Hz eased path instead of event-dependent double ticks. A purple
  insertion line previews the target card boundary. The same event-driven pointer session clears stale
  feedback on `leftMouseUp` without polling `pressedMouseButtons`, which can report zero during a drag.
- Swift Ratko now restores its status-item preference immediately to the left of macOS Wi-Fi on
  every launch, keeping the otter in the visible menu-bar cluster instead of letting a crowded bar
  park it off-screen.
- The Ratko installer now stops an already running copy before replacing and reopening the app, so
  an update cannot leave the previous binary running until the next login.
- The installer ad-hoc signs the completed app bundle after writing `Info.plist` and resources,
  preventing macOS RBS/POSIX 162 launch failures after an in-place binary replacement.
- Replaced the temporary otter emoji in the Swift menu bar and panel header with TaskMaster's
  original full-color Ratko artwork, packaged from the existing `src/assets` files.
- Sized the visually dense, full-color menu-bar artwork to 14 points so it matches the perceived
  size of neighboring line icons such as Wi-Fi. The earlier 22-point frame cropped Ratko, while
  even the uncropped 18-point frame still looked oversized because the artwork fills its square.
- Restored the AI feedback section in the Swift quick panel. It parses the newest section of the
  existing daily-feedback Markdown, shows the highlight while collapsed and the complete feedback
  when expanded, opens the source note, and can run the existing `daily-schedule-feedback` skill
  on demand. Scheduled generation remains owned by the Obsidian plugin to avoid duplicate runs.
- Existing step text can now be edited inline in a focus card. Clicking a step or its pencil opens
  an editor; Return or the checkmark saves, while the current-step pointer and elapsed seconds stay
  attached to the same step index.
- Inline step editing now saves and exits when the field loses focus or the panel closes; Escape
  and the explicit × still cancel without saving. Added Ratko-local `AGENTS.md` rules requiring
  entry, save, cancel, outside-click, error, and live-update UX to be designed for every feature.

## [0.19.0] - 2026-08-27

### Changed

- Moved Ratko's macOS menu bar, quick panel, timer, step tracking, memo entry, and focus window
  into the independent SwiftUI app under `native/TaskMasterRatko`.
- The Swift app now reads and writes the existing `TaskMaster/Tasks/*.md` and `.timers.json`
  contracts directly, so it continues running while Obsidian reloads or is closed.
- Removed the Obsidian renderer-owned Electron Tray, BrowserWindow popover, floating window,
  global shortcut, and TypeScript timer runtime. `.timers.json` now has one writer: Swift Ratko.
- Added a macOS app/LaunchAgent installer at `scripts/install-ratko.sh` and Swift contract tests.

## [0.18.3] - 2026-08-27

### Fixed

- On macOS, TaskMaster now restores its preferred status-item position before every Tray creation.
  It reads the Wi-Fi item's saved position and places the otter next to it (with the previously
  verified `250` fallback), so an Obsidian/plugin reload no longer returns the icon to Electron's
  default insertion point.

## [0.18.2] - 2026-08-27

### Fixed

- The empty-step hint (`+를 눌러 첫 단계를 추가해보세요`) is now a full-width click target that
  opens the inline step input. It previously looked actionable but was plain text; only the smaller
  `+ 단계 추가` control below it worked.

## [0.18.1] - 2026-08-26

### Fixed

- The per-card step control now says `+ Add step` instead of appearing as a tiny low-contrast
  square, and the drag grip is brighter. Both controls were present in 0.18.0 but too easy to miss
  against the dark quick-panel card.

## [0.18.0] - 2026-08-26

### Added

- Focus-card steps in the quick panel can now be dragged into a new order. Reordering moves each
  step's accumulated time and the active-step pointer with the step, including while its timer is
  running.
- Every focus card now has its own `+` button. It opens an inline step input for that card, instead
  of putting one shared input below the entire focus list.

### Note

The quick panel replaces its HTML every second while a timer runs. Step dragging uses the same
deferred-render contract as card dragging, so a timer tick cannot remove the node being dragged.

## [0.17.1] - 2026-08-24

### Fixed

- Scrolling inside the expanded AI report no longer jumps back to the top on the panel's
  per-second timer refresh. The panel already restored its outer vertical scroll and title
  horizontal scroll; keyed inner regions now preserve both axes across the same `innerHTML`
  replacement.

## [0.17.0] - 2026-08-23

### Added

- **The memo box now shows what you already wrote.** Opening `✎ 메모` reads the card's body and
  lists its past memos above the input, newest first, in a scrolling box. Writing a status note
  without seeing the previous one is half the feature — the point is continuing a thread, not
  filing isolated lines.
- Saving no longer closes the box. The list refreshes with the line you just wrote so you can keep
  going.

### Note

The body is not in the store — only `bodySummary` is — so it is read from disk when the box opens
and again after each save, never on the panel's per-second re-render. A malformed line in the memo
section is skipped rather than breaking the parse, since that file is edited by hand too.

## [0.16.0] - 2026-08-23

### Added

- **`✎ 메모` on every focus card.** It opens a text box inside the panel and what you write is
  appended to that card's note body, stamped with the time:

  ```
  ## 메모
  ### 2026-08-23
  - 18:42 지현님 답변 대기
  ```

  Same shape as the project quick memo (ADR-0011), so a day reads top to bottom. The point is not
  only jotting mid-task — the body is what an AI reads later when it summarizes or reviews the work,
  and until now nothing was writing to it from the panel.
- Existing body content is preserved: the memo is appended into (or after) a `## 메모` section, and
  a section that follows it stays below. Multi-line memos are folded into one indented bullet.
- Enter inserts a newline; `⌘/Ctrl+Enter` saves. The panel's submit handler used to look for
  `input[name="value"]` only, which would have silently ignored a textarea.

### Note on the shape

The memo box is inline in the panel, not a second window. This plugin has already paid for extra
native windows twice (the NSPanel investigation and the tray registry), and the panel's own
re-render already preserves in-progress input via `data-preserve`, so an inline box is both cheaper
and less likely to lose what you typed.

## [0.15.0] - 2026-08-23

### Added

- **Clicking a card title in the quick panel opens that card's note in Obsidian** — both the focused
  cards and the next-up list. The panel closes on the way out, since the note takes over the screen.
- The titles are not styled as links; they underline on hover only. The panel is something you read,
  and a column of blue links reads as noise.
- Inner links are marked `draggable="false"` so grabbing a title still starts the card drag between
  현재 작업 and 다음 할 일 instead of the browser's own link drag.

## [0.14.0] - 2026-08-23

### Added

- **`✨ 모두 채우기` next to the 현재 작업 heading.** It runs the card fill over every focused card
  that still has a blank, one at a time, and the status line shows `2/3 · 생성 중 14초` so a batch
  that takes a few minutes is legible. It only appears when two or more cards are fillable — with
  one card the per-card button already says everything.
- The batch is deliberately sequential. `AiDraftService.suggest()` joins an in-flight run instead of
  starting a second one, so firing them in parallel would read another card's suggestion and write
  it to the wrong card. `fillCard` now refuses outright while a run is in flight, which closes the
  same hole for double-clicks on two different cards.

### Changed

- The per-card button stays in place while a draft runs instead of disappearing; it just dims and
  stops being a link. Removing it mid-run shifted everything below it, which is how you end up
  clicking the wrong control.
- Both buttons are smaller (9.5px, tighter padding) — they sit inside a card and should not compete
  with the task title.

## [0.13.0] - 2026-08-23

### Changed

- **The quick panel's AI entry point moved onto each focus card and now fills attributes, not just
  steps.** It used to appear only when exactly one card was focused and that card had no steps, so
  it vanished the moment a second card entered DOING. Each focus card now carries its own
  `✨ AI로 채우기`, and it shows whenever that card still has a blank worth filling — empty steps,
  priority, tags, remarks or project.
- Filling attributes is the point, not a bonus: tags, priority and remarks are what a later search
  matches on, so a card with an empty frontmatter is a card that will not be found again.
- **Only blank fields are written.** The panel has no room for per-field accept/reject, so the rule
  is narrower than the edit modal's: a field that already holds a value is never touched, including
  steps. Running it on a card that already has steps therefore returns a critique instead, and those
  lines are now shown under the focus list instead of being discarded.

## [0.12.0] - 2026-08-23

### Added

- **Drag a card between 현재 작업 and 다음 할 일 in the quick panel.** Dropping a waiting task on
  the focus section moves it to DOING and starts its timer; dragging a focused card down to the
  next-up list stops measuring and puts it back in TODO.
- Dragging out is **not** the same as the ■ stop button. `stop` completes the card (status `done`)
  and adds the measured time to `actualMd`; the drag freezes the elapsed time and per-step seconds
  and only changes the status, so a card you picked up by mistake costs nothing to put down.
  The timer disappears because leaving `doing` removes it — no separate teardown path.
- The panel stops re-rendering while a drag is in flight. It repaints every second when a timer
  runs, and replacing `innerHTML` mid-drag drops the node being dragged, which cancels the drop.
  Pending HTML is buffered and applied on `dragend`.

### Fixed

- The menu bar tray now logs what it actually got: whether the icon image is empty, its size, and
  the item's bounds right after creation and again after 2s and 8s. The value read immediately
  after `new Tray` is pre-layout garbage (`{x:0, y:<screen height>, height:0}`); only the settled
  read shows where the item went. Measured on this machine: `x:-4219` (off-screen, pushed there by
  a menu bar manager) versus `x:865` with the manager quit. Without these lines the icon vanishing
  leaves no trace anywhere, because the item lives outside every window.

## [0.11.0] - 2026-08-23

### Added

- **AI draft for card fields.** The edit modal gained an `AI 초안` section with two paths:
  `빠르게 채우기` sends only the card (5-15s observed) and `깊게 채우기` lets Claude read past
  cards and the linked Jira issue (51-80s observed). It proposes priority, project, tags,
  remarks and a work plan. Suggestions are accepted or rejected **per field**, and a field that
  already holds a value starts unchecked, so a draft never silently replaces something you wrote.
- The model returns JSON only and never edits files. Accepted fields go through `TaskService`
  like any other edit, so `knownMtime` conflict detection, `passthrough` frontmatter and field
  order all keep working. Read-only tools (`Read,Grep,Glob`) are the only ones opened, and the
  write-capable permission mode used by the report is never passed. See ADR-0012.
- **Steps now carry a kind prefix** — `[결정] [조사] [실작업] [검증] [대기]`. The kind is a routing
  key for who does the step, not a time bucket: `결정` is people-only, `조사`/`실작업` can be
  delegated, `검증` is machine-run and human-judged, `대기` is nobody's work. `steps` stays
  `string[]`; no schema bump until the classification proves itself on real cards.
- The panel **reports rule breaks instead of fixing them** — no decision step, a first step that
  is neither decision nor research, fewer than 3 or more than 7 steps, an unreadable prefix.
  Silently repairing them would hide the fact that the model skipped the decision.
- **A card that already has steps is never overwritten.** In that case the run returns a critique
  (missing steps, decisions still open, order that does not hold) and the work plan is left alone.
- The quick panel shows `✨ AI로 단계 세우기` for a single focused card with no steps, with the
  elapsed counter and failure reason in the same row. Cards that already have steps get no
  entry point there — the panel has no room for per-field review.
- Settings (AI draft): enable, model (`sonnet` by default), timeout in minutes. The `claude`
  executable is shared with the AI report setting.

### Changed

- `claude` process spawning moved into `src/integration/claudeProcess.ts` and both the report and
  the draft call it. The report's arguments are unchanged and now covered by a test that stubs
  `window.require`, so the adapter that only runs on a real device is no longer untested.

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
