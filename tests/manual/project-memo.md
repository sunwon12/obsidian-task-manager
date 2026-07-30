# Project Memo Manual QA

Date: 2026-05-11

## Scope

Validate the Phase 2 quick memo path:

- selected project context header
- quick memo append into the project note
- Obsidian block id identity
- preview refresh
- conflict and external-edit recovery

## Desktop Smoke

- [ ] Create a project from the project selector.
- [ ] Select that project and confirm the project context header appears.
- [ ] Confirm `Open memo`, quick memo input, and `Save` are keyboard reachable in that order.
- [ ] Add a one-line memo with `Cmd/Ctrl + Enter`.
- [ ] Confirm the composer clears and the recent memo preview shows the memo.
- [ ] Open the project note and confirm the memo was appended under `## Quick Notes` / `### YYYY-MM-DD`.
- [ ] Confirm the memo bullet ends with `^tm-memo-<ULID>`.
- [ ] Use Create task, Promote note, and Copy link actions from a recent memo preview.
- [ ] Confirm Create task keeps the source memo link in the task body.
- [ ] Confirm Promote note creates a note under `TaskMaster/ProjectMemos/` and leaves a link under the source memo.

## Mobile Smoke

- [ ] Select a project on iOS Obsidian.
- [ ] Add a quick memo with the soft keyboard open.
- [ ] Confirm the Save button and status tabs do not overlap.
- [ ] Confirm the composer clears and preview refreshes.
- [ ] Repeat on Android Obsidian.
- [ ] Confirm preview action buttons wrap instead of overflowing on narrow width.

## External Edit Recovery

- [ ] Open the selected project note in an Obsidian editor leaf.
- [ ] Add or edit a quick memo directly under `## Quick Notes`.
- [ ] Return to TaskMaster and confirm the preview refreshes after Obsidian metadata updates.
- [ ] Remove the `## Quick Notes` heading manually, then save a new quick memo from TaskMaster.
- [ ] Confirm TaskMaster recreates `## Quick Notes` and the date heading without changing other sections.

## Conflict / Sync Scenario

- [ ] Open the same vault on two devices, or simulate with two Obsidian windows using a synced vault.
- [ ] On device A, select a project and start typing a quick memo.
- [ ] On device B, edit the same project note and sync the change.
- [ ] On device A, save the quick memo.
- [ ] Confirm the existing project note is not overwritten.
- [ ] Confirm the saved memo is present either in the merged project note or in a `- conflict YYYY...` project copy.
- [ ] Confirm Settings → Diagnostics contains a conflict entry if a conflicted copy was written.

## Same-Session Rapid Append

- [ ] Save two quick memos rapidly for the same project.
- [ ] Confirm both memos appear in the project note.
- [ ] Confirm each memo has a different `^tm-memo-<ULID>` block id.
