# TaskMaster

Local-first task and meeting management for Obsidian. React-powered Kanban inside your vault.

> **All your data lives as plain Markdown in your own vault.** No servers, no cloud lock-in, no telemetry.

## Why

Obsidian is excellent at storing knowledge — meetings, decisions, research notes — but it leaves the "things I need to do" management to other apps. TaskMaster brings a Trello-style Kanban board into Obsidian, with every task stored as a regular Markdown file you can edit, search, link, and back up like any other note.

## Features (Phase 1, v0.1.0)

- **Kanban board** with HOLD / TODO / DOING / IN REVIEW / DONE columns inside an Obsidian view.
- **Status visibility chips**: toggle board columns from rounded chips above the board; hidden statuses disappear without changing task data.
- **Task as Markdown**: every card is a `.md` file with frontmatter you can hand-edit.
- **Drag and drop** card reorder + status change on desktop / tablet.
- **Mobile-friendly**: status tabs + explicit "next status" buttons (no fragile touch dnd).
- **Keyboard navigation**: Tab to focus, `Enter` to open, `Cmd/Ctrl+Enter` to advance status, `Cmd/Ctrl+E` to archive, `Cmd/Ctrl+Backspace` to delete.
- **Project filter**: filter the board by project, or create new projects on the fly.
- **Project quick memo**: when a project is selected, append quick notes into its project note under `## Quick Notes`, with recent memo preview and block links.
- **Memo actions**: turn a quick memo into a task, promote it to a standalone note, or copy its Obsidian block link. Task conversion also links the created task back from the source memo.
- **Archive view, search, and priority filter**: review archived tasks, restore them, and narrow the active board without damaging board order.
- **Inline task metadata edit**: edit title, priority, and project from the card menu; body editing stays in Obsidian.
- **Meeting notes**: create a project-linked meeting note with an Action Items section from the project context header.
- **External edit aware**: edit the Markdown directly in Obsidian (or via Git/iCloud/Dropbox sync) and the board updates within ~250 ms.
- **Conflict detection**: never silently overwrites changes made outside the plugin.
- **Passthrough frontmatter**: any custom fields you add (`tags`, Dataview fields, other plugin metadata) are preserved across edits.
- **Settings & Diagnostics**: data root, debounce, locale, delete confirmation, and a 50-entry diagnostics log.
- **Korean / English**: follows your Obsidian locale or set explicitly.

## Where your data lives

```
[Your Vault]/
├── TaskMaster/
│   ├── Tasks/          ← every task as a Markdown file
│   ├── Meetings/       ← meeting notes
│   ├── Projects/       ← project notes
│   ├── ProjectMemos/   ← quick memos promoted to standalone notes
│   ├── Archive/        ← archived tasks
│   └── .board.json     ← visual order (synced across devices)
└── .obsidian/plugins/taskmaster-plugin/
    ├── data.json       ← in-memory index cache (device-local)
    └── settings.json   ← plugin settings (device-local)
```

Uninstall the plugin and your task notes stay readable in any text editor — no vendor lock-in.

## Install

### Manual

1. Download `manifest.json`, `main.js`, `styles.css` from the latest [Release](https://github.com/your-org/taskmaster-plugin/releases).
2. Copy them into `[YourVault]/.obsidian/plugins/taskmaster-plugin/`.
3. Open Obsidian → Settings → Community plugins → enable TaskMaster.

### BRAT (recommended for early users)

1. Install BRAT (Beta Reviewers Auto-update Tester) from Community plugins.
2. BRAT settings → "Add Beta plugin" → enter this repo URL.
3. BRAT auto-installs and updates on push.

### Build from source

```bash
git clone <repo>
cd taskmaster-plugin
npm install
npm run build
# dist/ now contains manifest.json + main.js + styles.css
# copy to your vault's plugin folder
```

## Usage

### Open the board

- Click the Kanban icon in the ribbon, or
- Command palette (`Cmd/Ctrl+P`) → "Open TaskMaster".

### Create a task

- Click `+ 새 할 일` (or "+ New task") in the board header.
- Title required; status and priority optional.
- Result: a Markdown file is created in `TaskMaster/Tasks/`.

### Move a task

- Desktop / tablet: drag the card between columns or within the same column.
- Mobile: tap the `→` arrow on a card to move to the next status.
- Keyboard: focus a card with Tab, then `Cmd/Ctrl+Enter` (next) or `Cmd/Ctrl+Shift+Enter` (previous).

### Show or hide statuses

- Use the rounded status chips above the board to show or hide `HOLD`, `TODO`, `DOING`, `IN REVIEW`, and `DONE`.
- Hidden statuses are removed from the board view and mobile tabs only; task Markdown, status, and board order stay unchanged.
- At least one status always remains visible.

### Edit details

- Click a card → the Markdown file opens in a new tab. Edit the body, frontmatter, or wikilinks freely.
- Use the card ⋮ menu → Edit to update title, priority, project, Jira key, or remarks without leaving the board.
- The board reflects frontmatter changes within 250 ms.

### Archive vs Delete

- **Archive** (`Cmd/Ctrl+E`; mobile also has a ⋮ menu): moves the file to `TaskMaster/Archive/`, removes from the board.
- **Delete** (`Cmd/Ctrl+Backspace`; mobile also has a ⋮ menu): trashes the file via Obsidian's system trash. Confirm dialog by default (toggle in settings).

### Projects

- Header dropdown shows all projects. Choose one to filter the board.
- `+ 새 프로젝트` creates a new project note in `TaskMaster/Projects/`.
- New tasks created while a project filter is active inherit that project automatically.
- A selected project shows a project context header with `Open memo`, `New meeting`, and a collapsible project memo area.
- The project memo area is collapsed by default; expand it to use the quick memo composer and recent memo preview.
- Quick memos are appended to `## Quick Notes` / `### YYYY-MM-DD` in the project note and get `^tm-memo-<ULID>` block ids.
- Recent memo actions can create a task with a source memo link, promote the memo to `TaskMaster/ProjectMemos/`, or copy the block link.
- When a memo is converted to a task, the source memo keeps a `Task: [[...]]` link to the created task.

### Search, filters, and archive

- Use the search box to match task title, body summary, or Jira key.
- Use the priority filter with project filters; hidden cards remain preserved during reorder.
- Click `Archive` in the header to review archived tasks, restore them, or delete them.

## Phase 2 Tracking

Phase 2 focuses on making projects feel like active workspaces, not only filters. The working task breakdown lives in [planning/TASKS2.md](planning/TASKS2.md).

## Phase 4 Tracking

Phase 4 continues the project workspace work with lightweight links between memos, tasks, and meetings. The working task breakdown lives in [planning/TASK4.md](planning/TASK4.md).

## Settings

Settings → Community plugins → TaskMaster:

| Setting | Default | Description |
| --- | --- | --- |
| Data root path | `TaskMaster` | Vault folder where everything is stored (read-only in v0.1.0). |
| Save debounce (ms) | 500 | Delay before persisting card reorders. 100–2000. Applies after reload. |
| Confirm on delete | on | Show a confirm dialog before deleting tasks. |
| Language | auto | UI locale. `auto` follows Obsidian. Applies after reload. |
| Diagnostics | — | Recent 50 parse / flush / conflict events. |

## Compatibility

- Obsidian desktop: ✅ full support.
- Obsidian mobile (iOS / Android): ✅ board + actions, ❌ no drag and drop (see [ADR-0009](planning/adr/0009-mobile-no-dnd-phase1.md)).
- Obsidian Sync, Git, iCloud, Dropbox: designed to handle external edits and `.board.json` conflicts gracefully.
- Other Obsidian plugins (Dataview, Templater, Tag Wrangler, …): your custom frontmatter fields are preserved.

## Out of scope (v0.1.0)

- Real-time multi-user collaboration.
- Cloud sync independent of Obsidian Sync / Git.
- LLM-based action item extraction (planned for Phase 4).
- Large board virtualization (>1 000 tasks; planned for Phase 5).
- Mobile dnd polish (planned for Phase 5).

## FAQ

**Q. The plugin is disabled. Are my tasks gone?**
No. They're plain Markdown files in `[Vault]/TaskMaster/`. Open them in any editor.

**Q. Two devices show different card orders.**
The visual order lives in `[Vault]/TaskMaster/.board.json` and is synced. If you also see this with Obsidian Sync's plugin folder excluded, that's expected — `.board.json` is intentionally placed inside the vault folder so it syncs.

**Q. I edit frontmatter directly. Is that safe?**
Yes. Stick to the documented fields and the board will keep up. Custom fields are passthrough-preserved (ADR-0008).

**Q. I see weird `conflict` files after sync.**
That means two devices changed the same Markdown at the same time. We never silently overwrite — see [PRD §7.8](planning/PRD.md).

## License

MIT.

## Acknowledgements

Built with React 18, dnd-kit, Zustand, Tailwind CSS, esbuild, and ULID.
# obsidian-task-manager
