# Milestone 1 완료 정의 checklist

PRD §17의 14개 항목을 모두 검증한 뒤 v0.1.0 GitHub Release 게시.

## Functional checklist (PRD §17)

- [ ] Obsidian에서 plugin이 정상 로드된다 (Settings → Community plugins).
- [ ] Ribbon 또는 command palette ("Open TaskMaster") 로 view를 열 수 있다.
- [ ] View 안에 React 기반 Todo / Doing / Done board가 렌더링된다.
- [ ] UI에서 task를 만들면 `TaskMaster/Tasks/` 아래 Markdown 파일이 생성된다 (`schemaVersion: 1`, ULID `id`, frontmatter 필드 모두 포함).
- [ ] task card를 다른 column으로 이동하면 Markdown frontmatter `status`가 즉시 갱신된다.
- [ ] 같은 column 안의 card 순서가 `.board.json`에 저장된다 (debounce 후).
- [ ] Obsidian reload 후 task와 board 순서가 복구된다.
- [ ] task Markdown 파일을 직접 수정하면 UI에 250 ms 이내 반영된다.
- [ ] task archive 액션이 동작한다 (Archive 폴더로 이동, archivedAt 추가).
- [ ] task delete 액션이 동작한다 (시스템 휴지통으로 이동).
- [ ] cache 파일을 삭제해도 PRD §9.4 알고리즘으로 board가 재생성된다.
- [ ] View close와 plugin unload 시 React root, event subscription, pending write가 정리된다.
- [ ] 키보드만으로 카드 생성 / 이동 / 순서 변경이 가능하다.
- [ ] 설정 화면에서 데이터 루트 경로와 debounce 시간을 확인하고 변경할 수 있다.

## i18n + a11y

- [ ] Obsidian locale 따라 한국어 / 영어 자동 전환 (Settings → Language로 강제 가능).
- [ ] `tests/manual/a11y.md` 모든 항목 통과.

## Test coverage

- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run lint` → 0 errors
- [ ] `npm test` → 모든 테스트 통과 (180+ tests)
- [ ] `npm run build` → `dist/main.js`, `dist/manifest.json`, `dist/styles.css` 산출
- [ ] `tests/perf/initialRender.test.ts` 통과 (1000 task 1초 이내)

## Manual QA

- [ ] `tests/manual/a11y.md` (T-605, T-707): pass
- [ ] `tests/manual/lifecycle.md` (T-702, T-703, T-704, T-705): pass
- [ ] `tests/manual/mobile.md` (T-706): pass on iOS, Android
- [ ] `tests/manual/passthrough-dataview.md` (T-708): pass with Dataview installed

## BRAT 호환 검증 (T-803)

- [ ] `manifest.json`이 repo root에 존재 + `dist/manifest.json`도 동일.
- [ ] BRAT으로 GitHub repo 추가 시 정상 install (manifest 발견 + main.js + styles.css 다운로드).
- [ ] BRAT 자동 업데이트 시도 → 새 release를 정상 detect.

## Release 산출물 (T-801, T-802, T-804)

- [ ] `README.md`: 한 페이지 소개 + 설치 + 사용법 + FAQ.
- [ ] `CHANGELOG.md`: `[0.1.0]` 섹션 with Added / Architecture decisions / Known limitations.
- [ ] GitHub Release `v0.1.0` 생성:
  - tag: `v0.1.0`
  - artifacts: `dist/manifest.json`, `dist/main.js`, `dist/styles.css`
  - release notes: CHANGELOG의 [0.1.0] 섹션 복사

## Sign-off

| 일자 | 역할 | 이름 | 서명 |
| --- | --- | --- | --- |
| _YYYY-MM-DD_ | Engineering | _name_ | ✓ |
| _YYYY-MM-DD_ | Product | _name_ | ✓ |
| _YYYY-MM-DD_ | QA | _name_ | ✓ |

모든 항목 ☑ 후 v0.1.0 published → Obsidian Community plugins 제출은 별도 milestone에서 진행 (PRD §15).
