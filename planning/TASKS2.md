# TaskMaster Phase 2 Tasks

- **Version**: 0.1
- **Date**: 2026-05-11
- **Source docs**: [PRD](PRD.md), [HLD](HLD.md), [TASKS](TASKS.md), [ADR Index](adr/README.md)
- **Phase theme**: usability hardening + project quick memo

## 1. Phase 2 방향

Phase 2의 목표는 TaskMaster를 단순한 Kanban view에서 "프로젝트별 작업 맥락을 빠르게 쌓는 Obsidian-native workspace"로 확장하는 것이다.

핵심 결정:

- Project는 단순 filter가 아니라 project memo의 home note가 되어야 한다.
- 빠른 memo는 기본적으로 memo마다 별도 page를 만들지 않는다.
- Quick memo는 selected project note의 `## Quick Notes` 섹션에 append한다.
- 독립 문서 가치가 생긴 memo만 사용자가 명시적으로 note로 승격한다.
- Phase 1에서 발견된 UX/data consistency 이슈를 project memo보다 먼저 정리한다.

비목표:

- LLM action item extraction.
- 대규모 board virtualization.
- 모바일 drag and drop.
- 복잡한 project dashboard.
- quick memo의 자동 요약/분류.

## 2. Milestone Map

| Milestone | 설명 | Tasks | 우선순위 |
| --- | --- | --- | --- |
| **P2-M0 Hardening** | Phase 1 사용성/정합성 보강 | T2-001 ~ T2-006 | P0 |
| **P2-M1 Project Memo Foundation** | project memo 진입점과 append 저장 | T2-101 ~ T2-108 | P0 |
| **P2-M2 Memo Actions** | memo를 task/note/link로 재사용 | T2-201 ~ T2-205 | P1 |
| **P2-M3 Markdown-Native Workflow** | archive/search/meeting/wikilink | T2-301 ~ T2-306 | P1 |
| **P2-M4 Validation & Docs** | QA, docs, release prep | T2-401 ~ T2-405 | P0/P1 |

## 3. P2-M0 Hardening

### T2-001 — filtered board reorder 보존
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: (none)
- **Outputs**: `src/ui/kanban/KanbanBoard.tsx`, `src/services/BoardService.ts`, tests
- **Why**: project filter나 hideCompleted가 켜진 상태에서 보이는 task만 reorder하면 숨겨진 task ID가 실제 column order에서 빠질 수 있다.
- **Done when**:
  - [x] filtered view에서 같은 column reorder 시 숨겨진 task ID가 보존된다.
  - [x] 보이는 task들의 상대 순서는 사용자의 drag 결과를 따른다.
  - [x] 숨겨진 task들은 기존 full column order 안에서 가능한 한 안정적으로 유지된다.
  - [x] selector/service 단위 테스트가 추가된다.

### T2-002 — DiagnosticsLog와 store.diagnostics 연결
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: (none)
- **Outputs**: `src/core/diagnostics.ts`, `src/main.ts`, `src/ui/settings/DiagnosticsPane.tsx`, tests
- **Why**: repository와 IndexService는 `DiagnosticsLog.record()`에 기록하지만 SettingsPane은 Zustand store의 `diagnostics`를 읽는다.
- **Done when**:
  - [x] runtime diagnostics가 SettingsPane에 즉시 표시된다.
  - [x] DiagnosticsLog와 store가 이중 source of truth가 되지 않는다.
  - [x] Notice throttle 정책은 유지된다.
  - [x] parse/flush/conflict record 경로가 테스트된다.

### T2-003 — settings 변경 적용 정책 정리
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: (none)
- **Outputs**: `src/ui/settings/SettingsPane.tsx`, `src/main.ts`, settings tests
- **Why**: settings 저장 후 현재 service/container에 즉시 반영되지 않는 값이 있다.
- **Done when**:
  - [x] `confirmOnDelete`, `jiraBaseUrl`은 현재 session UI에 즉시 반영된다.
  - [x] `locale`, `saveDebounceMs`처럼 runtime 재구성이 필요한 값은 reload 필요 notice 또는 명확한 helper text를 보여준다.
  - [x] settings object update가 stale reference를 만들지 않는다.
  - [x] README/PRD에 실제 정책이 반영된다.

### T2-004 — desktop card action menu
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-003
- **Outputs**: `src/ui/kanban/KanbanCard.tsx`, shared card menu component, tests
- **Why**: README와 HLD는 desktop card menu를 기대하지만 실제 desktop card에는 keyboard shortcut만 있다.
- **Done when**:
  - [x] desktop card에서 Open note, Archive, Delete 메뉴를 사용할 수 있다.
  - [x] mobile menu와 동작/label이 일관된다.
  - [x] menu button click이 card open 또는 drag와 충돌하지 않는다.
  - [x] keyboard와 screen reader 접근성이 검증된다.

### T2-005 — keyboard reorder 구현
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-001
- **Outputs**: `src/ui/kanban/KanbanCard.tsx`, `src/services/BoardService.ts`, tests
- **Why**: PRD는 `Cmd/Ctrl + ↑/↓` 같은 column 내부 순서 이동을 요구한다.
- **Done when**:
  - [x] focused card에서 `Cmd/Ctrl + ↑/↓`로 같은 column 내 순서를 바꿀 수 있다.
  - [x] project filter 상태에서도 T2-001의 hidden ID 보존 규칙을 따른다.
  - [x] 첫/마지막 card에서 no-op 처리된다.
  - [x] a11y checklist가 업데이트된다.

### T2-006 — project note open action
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: (none)
- **Outputs**: `src/services/ProjectService.ts`, `src/ui/kanban/BoardHeader.tsx` 또는 `ProjectContextHeader.tsx`
- **Why**: project note가 이미 존재하지만 보드에서 바로 열 수 없어 memo 사용성이 낮다.
- **Done when**:
  - [x] 특정 project filter 선택 시 `Open memo` 액션이 보인다.
  - [x] 클릭하면 해당 project Markdown note가 Obsidian editor에서 열린다.
  - [x] `all` 또는 `none` filter에서는 액션이 숨겨지거나 disabled 된다.
  - [x] missing project path는 non-blocking notice로 안내된다.

## 4. P2-M1 Project Memo Foundation

### T2-101 — project note 기본 템플릿
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-006
- **Outputs**: `src/services/ProjectService.ts`, `src/repositories/ProjectRepository.ts`, parser tests
- **Why**: 새 project note가 H1만 있으면 memo를 어디에 쓸지 사용자가 매번 판단해야 한다.
- **Done when**:
  - [x] 새 project note에 `Goal`, `Current Status`, `Decisions`, `References`, `Quick Notes` 섹션이 생성된다.
  - [x] 기존 project note에는 destructive migration을 하지 않는다.
  - [x] 템플릿은 Markdown으로 직접 수정 가능하다.
  - [x] Korean/English UI와 무관하게 사용자 데이터는 번역하지 않는다.

### T2-102 — ProjectMemoService append API
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-101
- **Outputs**: `src/services/ProjectMemoService.ts`, `src/repositories/ProjectRepository.ts`, tests
- **Why**: quick memo 저장은 UI가 직접 Markdown 문자열을 조작하지 않고 service/repository 경계를 따라야 한다.
- **Done when**:
  - [x] `appendMemo(projectId, text)`가 selected project note에 memo를 append한다.
  - [x] `## Quick Notes` 섹션이 없으면 생성한다.
  - [x] 오늘 날짜 heading `### YYYY-MM-DD`가 없으면 생성한다.
  - [x] memo는 현재 local time 기준 `HH:mm` prefix를 가진 bullet로 추가된다.
  - [x] 저장은 immediate flush이며 최신 file body를 다시 읽은 뒤 반영한다.

### T2-103 — project memo block identity
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-102
- **Outputs**: parser/helper tests, ADR draft if needed
- **Why**: memo를 task로 변환하거나 link copy하려면 memo를 안정적으로 다시 찾을 수 있어야 한다.
- **Done when**:
  - [x] block id 또는 internal marker 정책을 결정한다.
  - [x] Obsidian block reference와 충돌하지 않는 형식을 사용한다.
  - [x] append된 memo를 id로 찾아낼 수 있다.
  - [x] 정책이 PRD/HLD 또는 ADR에 반영된다.

### T2-104 — ProjectContextHeader UI
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-006
- **Outputs**: `src/ui/kanban/ProjectContextHeader.tsx`, i18n strings, tests
- **Why**: project가 선택되었을 때 작업 맥락과 memo 진입점이 보드 위에 있어야 한다.
- **Done when**:
  - [x] selected project title, `Open memo`, quick memo composer가 보인다.
  - [x] `all`/`none` filter에서는 compact empty state 또는 아무것도 표시하지 않는다.
  - [x] 좁은 viewport에서 header controls가 겹치지 않는다.
  - [x] keyboard focus order가 자연스럽다.

### T2-105 — quick memo composer
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-102, T2-104
- **Outputs**: `ProjectMemoComposer.tsx`, tests
- **Why**: memo는 "제목 없이 바로 쓰고 저장"할 수 있어야 한다.
- **Done when**:
  - [x] textarea 또는 compact expanding input으로 memo를 입력할 수 있다.
  - [x] `Cmd/Ctrl + Enter`와 Save button으로 저장된다.
  - [x] 빈 memo는 저장되지 않는다.
  - [x] 저장 중/실패/성공 상태가 화면에서 명확하다.
  - [x] 저장 후 input이 비워진다.

### T2-106 — recent memo preview
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-102, T2-104
- **Outputs**: `ProjectMemoPreview.tsx`, repository read helper, tests
- **Why**: project memo가 보드 맥락으로 살아 있으려면 최근 내용 일부가 보드에서 보여야 한다.
- **Done when**:
  - [x] selected project의 최근 quick memo 1~3개가 preview로 보인다.
  - [x] preview는 Markdown 원문을 과하게 렌더링하지 않고 안전한 plain text summary로 표시한다.
  - [x] memo append 후 preview가 갱신된다.
  - [x] project note 외부 수정 후 metadata event로 preview가 갱신된다.

### T2-107 — quick memo conflict/manual QA
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-102, T2-105
- **Outputs**: `tests/manual/project-memo.md`, repository tests
- **Why**: append-only memo는 sync 환경에서 실제 사용 패턴 검증이 중요하다.
- **Done when**:
  - [x] 두 device 또는 두 leaf에서 같은 project에 memo를 추가하는 시나리오를 수동 QA로 문서화한다.
  - [x] conflict 발생 시 memo 손실 없이 conflicted copy 또는 merge 결과를 확인할 수 있다.
  - [x] Obsidian editor에서 `## Quick Notes`를 직접 수정해도 UI가 복구된다.

### T2-108 — ProjectMemoService integration wiring
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-102
- **Outputs**: `src/main.ts`, `src/app/providers/TaskMasterProvider.tsx`, tests
- **Why**: 새 service가 기존 DI container와 multi-leaf shared store 규칙을 따라야 한다.
- **Done when**:
  - [x] ServiceContainer에 ProjectMemoService가 추가된다.
  - [x] 모든 TaskMasterView leaf가 같은 project memo service/store를 공유한다.
  - [x] unload 시 pending write 정책이 명확하다.

## 5. P2-M2 Memo Actions

### T2-201 — quick memo를 task로 변환
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-103, T2-105
- **Outputs**: `ProjectMemoActions.tsx`, `TaskService` integration, tests
- **Done when**:
  - [x] memo text를 기반으로 task draft가 생성된다.
  - [x] selected project id가 task project로 자동 설정된다.
  - [x] 생성된 task body에는 원본 memo block reference 또는 project note link가 포함된다.
  - [x] 변환 후 원본 memo를 삭제하지 않는다.

### T2-202 — quick memo를 standalone note로 승격
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-103
- **Outputs**: project memo promote service, tests
- **Done when**:
  - [x] memo 내용을 새 Markdown note로 생성할 수 있다.
  - [x] 새 note는 project note와 backlink/wikilink로 연결된다.
  - [x] 원본 memo에는 승격된 note link를 남긴다.
  - [x] 파일명 충돌을 안전하게 처리한다.

### T2-203 — memo link copy
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-103
- **Outputs**: UI action, tests/manual
- **Done when**:
  - [x] memo block 또는 project note section link를 clipboard에 복사할 수 있다.
  - [x] Obsidian에서 열 수 있는 wikilink 형식을 사용한다.
  - [x] link copy 실패 시 Notice를 보여준다.

### T2-204 — project log split ADR
- **Status**: ✅ done (2026-05-11)
- **Priority**: P2
- **Dependencies**: T2-107
- **Outputs**: `planning/adr/0011-project-quick-memo-storage.md` 또는 equivalent
- **Done when**:
  - [x] project note append를 유지할지, 월간/주간 log 파일로 분리할지 기준을 문서화한다.
  - [x] 실제 QA/사용 피드백을 근거로 한다.
  - [x] migration/compatibility 영향을 명시한다.

### T2-205 — quick memo 모바일 polish
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-105
- **Outputs**: mobile QA update, UI adjustments
- **Done when**:
  - [x] 모바일에서 soft keyboard가 composer를 가리지 않는다.
  - [x] 저장 버튼과 status tabs가 겹치지 않는다.
  - [x] iOS/Android manual QA가 통과한다.

## 6. P2-M3 Markdown-Native Workflow

### T2-301 — archive view
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-004
- **Outputs**: archive UI, service helpers, tests
- **Done when**:
  - [x] archived tasks를 view/filter로 볼 수 있다.
  - [x] archived task를 active board로 restore할 수 있다.
  - [x] delete와 archive의 차이가 UI에서 분명하다.

### T2-302 — search and priority filter
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-001
- **Outputs**: selector/store updates, tests
- **Done when**:
  - [x] title/body summary 검색을 제공한다.
  - [x] priority filter를 제공한다.
  - [x] project filter와 조합해도 board order가 손상되지 않는다.

### T2-303 — inline title/priority/project edit
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-004
- **Outputs**: card edit controls, tests
- **Done when**:
  - [x] title을 inline 또는 small modal로 수정할 수 있다.
  - [x] priority와 project를 card에서 빠르게 바꿀 수 있다.
  - [x] 모든 변경은 Markdown frontmatter에 immediate flush된다.

### T2-304 — meeting note UI
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-104
- **Outputs**: meeting creation/open UI, tests
- **Done when**:
  - [x] project context에서 meeting note를 만들 수 있다.
  - [x] meeting note가 selected project와 연결된다.
  - [x] meeting note 기본 템플릿이 action item section을 포함한다.

### T2-305 — wikilink helper and backlinks
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-201, T2-304
- **Outputs**: link helpers, tests/manual
- **Done when**:
  - [x] task/project/meeting 사이 wikilink 삽입 helper를 제공한다.
  - [x] task body에 source memo 또는 meeting link를 쉽게 남길 수 있다.
  - [x] Obsidian backlinks에서 관계가 자연스럽게 보인다.

### T2-306 — inline body summary
- **Status**: ✅ done (2026-05-11)
- **Priority**: P2
- **Dependencies**: T2-302
- **Outputs**: summary parser/render helper, tests
- **Done when**:
  - [x] card 또는 side panel에서 body 첫 문단/summary를 볼 수 있다.
  - [x] full body editing은 Obsidian editor에 위임한다.
  - [x] Markdown rendering 방식은 HLD open question을 해소하고 문서화한다.

## 7. P2-M4 Validation & Docs

### T2-401 — Project memo manual QA
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-105, T2-107
- **Outputs**: `tests/manual/project-memo.md`
- **Done when**:
  - [x] desktop에서 project 선택 → memo 추가 → project note 확인이 통과한다.
  - [x] 모바일에서 memo 추가가 통과한다.
  - [x] 외부 editor 수정과 sync conflict 시나리오가 포함된다.

### T2-402 — a11y/manual QA 갱신
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-004, T2-005, T2-105
- **Outputs**: `tests/manual/a11y.md`, `tests/manual/mobile.md`
- **Done when**:
  - [x] desktop menu와 quick memo composer가 keyboard로 운용된다.
  - [x] screen reader label이 검증된다.
  - [x] focus order가 BoardHeader → ProjectContextHeader → Board 순서로 자연스럽다.

### T2-403 — README/PRD/HLD sync
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: all P2-M0/P2-M1 tasks
- **Outputs**: `README.md`, `planning/PRD.md`, `planning/HLD.md`
- **Done when**:
  - [x] 실제 구현과 README feature/usage 설명이 일치한다.
  - [x] Phase 2에서 결정된 storage/link 정책이 PRD/HLD에 반영된다.
  - [x] open questions가 해결되면 ADR 또는 문서에 기록된다.

### T2-404 — automated test coverage
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: all implementation tasks
- **Outputs**: Vitest suites
- **Done when**:
  - [x] `npm test` 통과.
  - [x] `npm run typecheck` 통과.
  - [x] `npm run lint` 통과.
  - [x] ProjectMemoService와 filtered reorder의 핵심 edge case가 자동 테스트된다.

### T2-405 — Phase 2 release prep
- **Status**: ✅ done (2026-05-11)
- **Priority**: P1
- **Dependencies**: T2-401 ~ T2-404
- **Outputs**: `CHANGELOG.md`, release checklist
- **Done when**:
  - [x] changelog에 Phase 2 user-facing changes가 기록된다.
  - [x] manual QA 결과가 문서화된다.
  - [x] release artifacts build가 통과한다.

## 8. 진행 원칙

- P2-M0은 project memo보다 먼저 끝낸다. 특히 filtered reorder와 Diagnostics/settings는 데이터 신뢰와 디버깅 가능성에 직접 영향이 있다.
- Project quick memo의 첫 구현은 작게 유지한다: selected project note append, open memo, composer, preview까지만 먼저 완성한다.
- memo마다 파일을 자동 생성하지 않는다. standalone note는 사용자의 명시적 promote 액션에서만 만든다.
- implementation이 PRD/HLD와 달라지면 코드보다 문서를 먼저 고치거나, 같은 PR에서 함께 고친다.
