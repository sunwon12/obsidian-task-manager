<div align="center">

# TaskMaster

### Local-first work management for Obsidian

Keep personal tasks, project notes, meetings, and Jira issues in one calm Kanban board — while every note remains yours.

[![Obsidian](https://img.shields.io/badge/Obsidian-1.5%2B-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-16a34a.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-385%20passing-16a34a.svg)](#development)

</div>

> **Your data stays in your vault.** TaskMaster stores tasks, projects, and meeting notes as plain Markdown — no TaskMaster server, account, or vendor lock-in.

## Why TaskMaster?

Work usually lives in Jira; life does not. TaskMaster gives both a home without forcing every personal task, meeting follow-up, or idea into a Jira ticket.

```text
Jira issues ── sync ──┐
                       ├── TaskMaster board ──→ HOLD · TODO · DOING · IN REVIEW · DONE
Local Markdown tasks ──┘
```

| Jira work | Local work |
| --- | --- |
| Imported automatically by JQL | Created directly in TaskMaster |
| Jira key opens the original issue | Never sent to Jira |
| Status is refreshed from Jira | You control the status on the board |

## Highlights

- **One Kanban board** — HOLD, TODO, DOING, IN REVIEW, and DONE.
- **Jira sync** — import your assigned Jira issues with JQL; no duplicate manual cards.
- **Tags that stay visible** — classify cards with tags such as `업무`, `학습`, or `업무외` and see them directly on the board.
- **Measured work plan beside the timer** — add ordered steps, select or automate `currentStep`, and see each step's live elapsed time. Per-step seconds are saved back to task frontmatter for later analysis.
- **Independent Swift menu-bar app** — Ratko runs separately from Obsidian, stays available while Obsidian reloads or is closed, and reads the same Markdown tasks directly. On every launch it restores its status-item preference immediately to the left of macOS Wi-Fi so a crowded menu bar does not park the otter off-screen. Click it to see active work and elapsed time, add or reorder steps, write a memo, create a task, or start a waiting task.
- **AI report in the panel** — the top of the quick panel carries a daily report written by a Claude Code skill. TaskMaster runs it headlessly (`claude -p "/daily-schedule-feedback"` from the vault root), reads the Markdown the skill writes, and shows its newest section: a snapshot, bullet feedback, and one highlight. It runs once a day after the configured time when today's section is missing, and `↻ 리포트 받기` runs it on demand with a live elapsed counter. Skill prompt, report path, `claude` executable, schedule and timeout are all in settings; **Run AI report now** is in the command palette.
- **Drag between 현재 작업 and 다음 할 일** — in the quick panel, drag a waiting task onto the focus section to move it to DOING and start its timer, or drag a focused card down to put it back in TODO. Putting a card down is not the same as stopping it: ■ completes the card and books the measured time to `actualMd`, while the drag only freezes the elapsed time and changes the status, so picking up the wrong card costs nothing.
- **AI draft for a card** — the edit modal has an **AI 초안** section: `빠르게 채우기` reads only the card (5-15s), `깊게 채우기` searches past cards and the linked Jira issue (1-2 min). It proposes priority, project, tags, remarks and a work plan, and you accept or reject **per field** — fields that already hold a value start unchecked. Nothing touches disk until you save; the model returns JSON and TaskMaster applies it through the normal task service, so external-edit detection and custom frontmatter still hold. Steps are typed with a prefix — `[결정] [조사] [실작업] [검증] [대기]` — and the panel flags rule breaks (no decision step, a first step that is neither decision nor research, too few or too many steps) instead of quietly fixing them. **When a card already has steps, TaskMaster never overwrites them**: it returns a critique instead. Every focused card in the quick panel carries its own `✨ AI로 채우기` whenever it still has a blank — empty steps, priority, tags, remarks or project. There it writes **only into blank fields**, since a narrow panel has no room for per-field review; a card that already has steps gets a critique shown under the list instead.
- **Desktop pin** — use the menu-bar item's right-click menu when you explicitly want a compact always-on-top timer panel (Obsidian desktop only). TaskMaster does not cover the Obsidian window with an automatic timer banner.
- **Markdown-native** — task cards, projects, meetings, and memos are ordinary files you can search, link, edit, and back up.
- **Projects that hold context** — attach tasks, meeting notes, and quick memos to a project.
- **Fast daily use** — drag-and-drop on desktop, focused mobile controls, keyboard shortcuts, search, priority and project filters.
- **Safe by default** — external edits are detected; custom frontmatter is preserved; conflicts are never silently overwritten.
- **Korean and English** — follows the Obsidian language setting.

## What gets stored

```text
Your vault/
└── TaskMaster/
    ├── Tasks/          # one Markdown file per active card
    ├── Projects/       # project notes and quick memos
    ├── Meetings/       # project-linked meeting notes
    ├── ProjectMemos/   # promoted quick memos
    ├── Archive/        # archived task files
    └── .board.json     # visual card order
```

Disable or uninstall the plugin and these files are still readable in any Markdown editor.

## Install

### Build from source

```bash
git clone https://github.com/sunwon12/obsidian-task-manager.git
cd obsidian-task-manager
npm install
npm run build
```

Copy `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` into:

```text
<your-vault>/.obsidian/plugins/taskmaster-plugin/
```

Then enable **TaskMaster** under **Settings → Community plugins** and use the ribbon icon or the `Open TaskMaster` command.

> For early updates, use the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin and add this repository URL.

## Jira sync

Jira integration is intentionally **one-way: Jira → TaskMaster**. It is designed to put existing work next to local work without changing Jira accidentally.

1. Open **Settings → Community plugins → TaskMaster**.
2. Set the Jira API URL, authentication method, API token, and JQL query.
3. Click **Sync Jira**, or run the **Sync Jira issues** command.
4. TaskMaster creates cards by Jira key once, then updates the same cards on later syncs.

### Authentication

| Jira deployment | Authentication | REST API version |
| --- | --- | --- |
| Jira Cloud | Email + API token | `3` |
| Jira Server / Data Center | Personal access token (Bearer) | `2` |

The default JQL only retrieves your unfinished work:

```jql
assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC
```

Jira statuses are mapped automatically:

| Jira status contains | TaskMaster column |
| --- | --- |
| Done, Closed, Resolved, Complete | DONE |
| Review, QA, Test | IN REVIEW |
| In Progress, Development, Working | DOING |
| Hold, Blocked | HOLD |
| anything else | TODO |

### Security

The API token is stored only in Obsidian's device-local plugin data. It is never written to task Markdown or included in this repository. **Never commit** `.obsidian/plugins/taskmaster-plugin/data.json` from a vault that has Jira credentials configured.

## Everyday workflow

1. Let Jira sync work tickets onto the board.
2. Add personal tasks, ideas, and meeting follow-ups directly in TaskMaster.
3. Drag cards through the board as work progresses.
4. Add comma-separated tags while creating or editing a card — for example: `업무, 학습`.
5. Select a project to keep its tasks, notes, meetings, and quick memos together.
6. Archive completed work when you no longer need it on the board.

### Useful shortcuts

| Action | Shortcut |
| --- | --- |
| Advance a focused card | `Cmd/Ctrl + Enter` |
| Move a focused card back | `Cmd/Ctrl + Shift + Enter` |
| Archive a focused card | `Cmd/Ctrl + E` |
| Delete a focused card | `Cmd/Ctrl + Backspace` |

## Development

```bash
npm install
npm test          # unit and UI tests
npm run typecheck
npm run lint
npm run build     # writes the distributable files to dist/
```

The project uses TypeScript, React, Zustand, dnd-kit, Tailwind CSS, and esbuild.

## Compatibility

| Platform | Support |
| --- | --- |
| Obsidian desktop | Full support, including drag and drop |
| Obsidian mobile | Board and actions supported; no drag and drop |
| Obsidian Sync / Git / iCloud / Dropbox | Supported; card order is stored inside the vault |

## License

[MIT](LICENSE)
