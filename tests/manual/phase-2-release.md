# Phase 2 Release Checklist

Date: 2026-05-11

## Automated Gates

- [x] `npm test`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run build`

## Manual QA Documents

- [ ] `tests/manual/project-memo.md`
- [ ] `tests/manual/a11y.md`
- [ ] `tests/manual/mobile.md`
- [ ] `tests/manual/lifecycle.md`

## Release Artifacts

- [x] `dist/main.js` generated.
- [x] `dist/styles.css` generated.
- [x] `dist/manifest.json` generated.
- [x] `CHANGELOG.md` includes Phase 2 user-facing changes.
- [x] README usage matches the released UI.

## Smoke Scenarios

- [ ] Open TaskMaster from ribbon and command palette.
- [ ] Create project → add quick memo → open project memo note.
- [ ] Convert quick memo to task and confirm source memo wikilink.
- [ ] Promote quick memo to standalone note and confirm backlinks.
- [ ] Archive task → restore from Archive view.
- [ ] Search and priority filters do not change persisted board order.
