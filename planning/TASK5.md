# TaskMaster Phase 5 Tasks

- **Version**: 0.1
- **Date**: 2026-05-15
- **Source docs**: [PRD](PRD.md), [HLD](HLD.md), [TASK4](TASK4.md)
- **Phase theme**: kanban workflow and task metadata polish

## 1. Phase 5 방향

Phase 5는 칸반보드의 실제 업무 흐름을 더 세분화하고, 카드 미리보기에서 Markdown 본문이 그대로 노출되는 문제를 줄인다. Task note 본문은 상세 기록 장소로 유지하되, 보드 카드에는 사용자가 명시적으로 관리하는 짧은 속성만 보여준다.

핵심 원칙:

- 칸반 상태는 `HOLD → TODO → DOING → IN REVIEW → DONE` 순서를 기준으로 동작한다.
- 기존 task의 `todo`, `doing`, `done` status는 그대로 유효해야 한다.
- 카드에서는 Markdown body preview를 보여주지 않는다.
- 카드에 보일 추가 설명은 task frontmatter 속성 `remarks`로 저장하고, UI label은 `비고`로 표시한다.
- `jiraKey`와 `비고`는 task 생성뿐 아니라 Edit task에서도 수정할 수 있어야 한다.
- task body는 Obsidian note 본문으로 남겨두고, 카드용 요약 데이터와 혼용하지 않는다.

비목표:

- 카드 안에서 Markdown 본문을 렌더링하는 rich preview 도입.
- `비고`를 다중 paragraph/rich text editor로 확장.
- 기존 task body 내용을 자동으로 `remarks`로 마이그레이션.
- status별 WIP limit, swimlane, assignee 등 추가 보드 기능.

## 2. Milestone Map

| Milestone | 설명 | Tasks | 우선순위 |
| --- | --- | --- | --- |
| **P5-M1 Kanban Status Expansion** | 5단계 workflow status 도입 | T5-101 ~ T5-104 | P0 |
| **P5-M2 Remarks Property** | 카드 미리보기 제거 및 `비고` 속성 도입 | T5-201 ~ T5-204 | P0 |
| **P5-M3 Edit Task Metadata** | Edit task에서 Jira key/비고 수정 | T5-301 ~ T5-303 | P0/P1 |
| **P5-M4 Validation & Docs** | 테스트, QA, 문서 반영 | T5-401 ~ T5-404 | P0/P1 |

## 3. P5-M1 Kanban Status Expansion

### T5-101 — task status model expansion
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: (none)
- **Outputs**: `ColumnId`, `TaskStatus`, status helper/order constants, parser tests
- **Why**: 현재 보드는 `todo/doing/done` 3단계만 지원해서 실제 업무 흐름의 보류와 리뷰 상태를 표현하기 어렵다.
- **Done when**:
  - [x] `TaskStatus`가 `hold`, `todo`, `doing`, `in-review`, `done`을 지원한다.
  - [x] display label은 `HOLD`, `TODO`, `DOING`, `IN REVIEW`, `DONE`으로 통일한다.
  - [x] status order가 한 곳에서 관리되어 desktop, mobile, keyboard 이동이 같은 순서를 사용한다.
  - [x] 기존 `todo/doing/done` task는 migration 없이 그대로 parse된다.
  - [x] invalid status는 기존처럼 task parse 대상에서 제외된다.

### T5-102 — board state and reconcile update
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T5-101
- **Outputs**: `BoardRepository`, `BoardService`, board tests
- **Why**: board column 구조와 reconcile 로직이 새 status를 모르면 새 task가 보드에 나타나지 않거나 이동 순서가 깨질 수 있다.
- **Done when**:
  - [x] 기본 board columns가 `hold`, `todo`, `doing`, `in-review`, `done` 순서로 생성된다.
  - [x] 기존 board json에 새 column이 없으면 안전하게 보강한다.
  - [x] 기존 column의 task order는 가능한 한 보존한다.
  - [x] task frontmatter status와 board column이 다를 때는 기존 원칙대로 frontmatter status를 신뢰한다.
  - [x] archive/delete/reconcile 테스트가 5개 column 기준으로 갱신된다.

### T5-103 — desktop/mobile movement update
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T5-102
- **Outputs**: `KanbanBoard`, `KanbanCard`, `MobileBoard`, UI tests
- **Why**: drag and drop, keyboard shortcut, mobile next/previous 버튼이 모두 새 status order를 알아야 한다.
- **Done when**:
  - [x] desktop drag target이 5개 column 모두에서 동작한다.
  - [x] `Cmd/Ctrl+Enter`는 다음 status로, `Cmd/Ctrl+Shift+Enter`는 이전 status로 이동한다.
  - [x] mobile board는 5개 status tab을 작은 화면에서도 사용할 수 있다.
  - [x] mobile next/previous 버튼의 aria-label이 새 status label을 반영한다.
  - [x] 마지막 `done`, 첫 `hold`에서 이동 shortcut/button은 no-op 처리된다.

### T5-104 — status UI labels and creation flow
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T5-101
- **Outputs**: `NewTaskModal`, i18n strings, status label tests
- **Why**: task 생성 시에도 새 status를 선택할 수 있어야 하고, 한국어/영어 UI label이 일관되어야 한다.
- **Done when**:
  - [x] New task status select에 5개 status가 순서대로 표시된다.
  - [x] board column header와 mobile tab label이 같은 label source를 사용한다.
  - [x] `in-review` frontmatter 값은 화면에서 `IN REVIEW`로 표시된다.
  - [x] ko/en i18n key가 모두 추가된다.

## 4. P5-M2 Remarks Property

### T5-201 — task `remarks` frontmatter property
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: (none)
- **Outputs**: core type, parser/serializer, `TaskService`, tests
- **Why**: 카드에 보여줄 짧은 설명을 Markdown body에서 추출하면 raw Markdown 문법이 그대로 노출되어 보드 scan 경험이 나빠진다.
- **Done when**:
  - [x] `Task`에 `remarks: string | null`을 추가한다.
  - [x] frontmatter key는 `remarks`, UI label은 `비고`로 사용한다.
  - [x] absent/empty `remarks`는 `null`로 parse하고 write 시 frontmatter에서 제거한다.
  - [x] `CreateTaskInput`과 task 생성 flow가 `remarks`를 받을 수 있다.
  - [x] `TaskService`에 remarks 수정 API를 추가하거나 기존 update API가 remarks를 저장한다.
  - [x] passthrough frontmatter 보존 정책은 유지된다.

### T5-202 — remove Markdown body preview from cards
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T5-201
- **Outputs**: `KanbanCard`, `MobileBoard`, selector/UI tests
- **Why**: 현재 카드 하단에 task body summary가 표시되면서 checkbox, wikilink, heading 같은 Markdown 문법이 그대로 보인다.
- **Done when**:
  - [x] 카드 UI에서 `bodySummary` 기반 Markdown body preview를 제거한다.
  - [x] `remarks`가 있을 때만 카드에 짧게 표시한다.
  - [x] `remarks`는 plain text로 표시하고 1~2줄 clamp 처리한다.
  - [x] `remarks`가 없으면 카드 높이를 불필요하게 늘리지 않는다.
  - [x] 검색용 body summary가 필요하면 index에는 남기되 카드 렌더링과 분리한다.

### T5-203 — New task remarks input
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T5-201
- **Outputs**: `NewTaskModal`, i18n strings, UI tests
- **Why**: `비고`를 카드에서 보여주려면 task 생성 시점에도 자연스럽게 입력할 수 있어야 한다.
- **Done when**:
  - [x] New task modal에 `비고` textarea/input을 추가한다.
  - [x] 입력값은 trim 후 빈 값이면 저장하지 않는다.
  - [x] `비고` 입력은 task body와 별개로 frontmatter `remarks`에 저장된다.
  - [x] modal layout이 좁은 화면에서도 깨지지 않는다.

### T5-204 — search and filtering consistency
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T5-201
- **Outputs**: selectors/tests
- **Why**: 카드에서 보이는 `jiraKey`와 `비고`는 검색 경험에서도 예측 가능하게 동작해야 한다.
- **Done when**:
  - [x] 검색 대상에 `remarks`가 포함된다.
  - [x] 기존 title/body summary/Jira key 검색 동작은 회귀하지 않는다.
  - [x] `remarks`가 없는 task도 정상적으로 필터링된다.

## 5. P5-M3 Edit Task Metadata

### T5-301 — Edit task Jira key and remarks fields
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T5-201
- **Outputs**: `EditTaskModal`, `KanbanCard` save handler, UI tests
- **Why**: 현재 Edit task는 title, priority, project만 수정할 수 있어 이미 만든 task의 Jira key와 카드용 비고를 고치려면 Markdown을 직접 열어야 한다.
- **Done when**:
  - [x] Edit task modal에서 `jiraKey`를 수정할 수 있다.
  - [x] Edit task modal에서 `비고`를 수정할 수 있다.
  - [x] 저장 시 변경된 필드만 task service에 반영한다.
  - [x] `jiraKey`와 `remarks`는 trim 후 빈 값이면 `null`로 저장한다.
  - [x] 저장 후 카드의 Jira link/text와 `비고` 표시가 즉시 갱신된다.

### T5-302 — task metadata save behavior
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T5-301
- **Outputs**: service tests, integration tests
- **Why**: Edit modal에서 여러 필드를 저장할 때 각 필드가 별도 flush되면 불필요한 write가 늘고 conflict surface가 커질 수 있다.
- **Done when**:
  - [x] title, priority, project, jiraKey, remarks를 한 번의 update flow로 저장할 수 있는지 검토한다.
  - [x] 한 번의 저장이 어렵다면 기존 service API를 사용하되 no-op field는 write하지 않는다.
  - [x] `updatedAt`은 실제 변경이 있을 때만 갱신된다.
  - [x] external frontmatter field passthrough는 유지된다.
  - [x] conflict detection 동작은 기존 task update와 동일하다.

### T5-303 — mobile edit parity
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T5-301
- **Outputs**: `MobileBoard`, UI tests/manual QA
- **Why**: mobile card menu에는 현재 Edit action이 없어 새 metadata를 모바일에서 수정하기 어렵다.
- **Done when**:
  - [x] mobile card menu에 Edit action을 추가한다.
  - [x] mobile에서도 같은 Edit task modal을 열 수 있다.
  - [x] soft keyboard가 열린 상태에서 modal footer/button이 가려지지 않는다.
  - [x] mobile에서 Jira key/비고 저장 후 카드가 즉시 갱신된다.

## 6. P5-M4 Validation & Docs

### T5-401 — parser/service regression tests
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T5-101, T5-201, T5-301
- **Outputs**: parser/service/integration tests
- **Done when**:
  - [x] 5개 status parse/serialize 테스트가 추가된다.
  - [x] `remarks` parse/serialize 테스트가 추가된다.
  - [x] Edit task metadata 저장 테스트가 추가된다.
  - [x] 기존 `jiraKey` parse/serialize 테스트가 회귀하지 않는다.

### T5-402 — UI and accessibility QA
- **Status**: planned
- **Priority**: P1
- **Dependencies**: T5-103, T5-203, T5-303
- **Outputs**: UI tests, manual QA doc update
- **Done when**:
  - [ ] 5개 column이 desktop에서 overflow 없이 scan 가능하다.
  - [ ] mobile status tab이 keyboard/screen reader에서 정상적으로 전달된다.
  - [ ] Edit/New task의 `비고` field label이 접근 가능하다.
  - [ ] 카드에는 Markdown body preview가 보이지 않는다.
  - [ ] `remarks`가 긴 경우에도 카드 layout이 깨지지 않는다.

### T5-403 — docs update
- **Status**: planned
- **Priority**: P1
- **Dependencies**: implemented P5 tasks
- **Outputs**: README/PRD/HLD/manual docs updates
- **Done when**:
  - [ ] README의 board status 설명이 5단계 workflow와 일치한다.
  - [ ] PRD/HLD에 `remarks` 속성과 카드 preview 정책이 반영된다.
  - [ ] manual QA 문서에 새 status와 Edit task metadata 시나리오가 추가된다.

### T5-404 — release verification
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: P5-M1, P5-M2, P5-M3 complete
- **Outputs**: typecheck/test/lint/build
- **Done when**:
  - [x] `npm run typecheck`
  - [x] `npm test`
  - [x] `npm run lint`
  - [x] `npm run build`

## 7. 진행 메모

- 2026-05-15: T5-101 ~ T5-303 구현 완료. status model은 `hold/todo/doing/in-review/done`으로 확장했고, card preview는 `remarks` 기반으로 교체했다.
- 2026-05-15: Edit task/New task에서 Jira key와 `비고` 입력을 지원한다. metadata 저장은 `TaskService.updateTask` 단일 flow를 사용한다.
- 2026-05-15: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` 통과.
- 남은 문서 작업: T5-403 README/PRD/HLD/manual QA 반영.
