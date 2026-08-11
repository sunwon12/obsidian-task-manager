<div align="center">

# TaskMaster

### Local-first work management for Obsidian

Keep personal tasks, project notes, meetings, and Jira issues in one calm Kanban board — while every note remains yours.

[![Obsidian](https://img.shields.io/badge/Obsidian-1.5%2B-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-16a34a.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-254%20passing-16a34a.svg)](#development)

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
- **Work plan beside the timer** — add ordered steps to a task and keep `currentStep` updated manually or through automation; completed/current/pending steps stay visible under the timer.
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
