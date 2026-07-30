# TaskMaster Phase 6 Tasks

- **Version**: 0.1
- **Date**: 2026-05-15
- **Source docs**: [PRD](PRD.md), [HLD](HLD.md), [TASK5](TASK5.md)
- **Phase theme**: faster kanban actions and board density controls

## 1. Phase 6 방향

Phase 6는 5단계 칸반보드에서 늘어난 조작 비용을 줄인다. 새 task 생성, status 변경, 비고 수정처럼 자주 반복되는 행동을 modal 중심 흐름에서 더 가까운 위치로 가져오고, 5개 column이 한 화면을 과하게 차지하지 않도록 접기 기능을 제공한다.

핵심 원칙:

- 사용자가 보고 있는 column context에서 바로 task를 만들 수 있어야 한다.
- status 변경은 drag and drop, keyboard shortcut, mobile arrow 외에도 명시적 menu action으로 가능해야 한다.
- `비고`는 카드 스캔용 짧은 속성이므로 Edit task modal보다 가벼운 편집 경로가 필요하다.
- column 접기는 보드 밀도를 낮추는 UI 상태이며 task 의미 데이터에는 영향을 주지 않는다.
- Phase 5의 5단계 status order와 `remarks` schema를 그대로 사용한다.

비목표:

- stale/idle age 표시.
- HOLD reason 입력 유도 또는 강제.
- 저장된 필터/뷰 preset.
- 수동 정렬 모드와 최신순 모드의 정책 재설계.
- status별 WIP limit, assignee, due date, schedule field 추가.

## 2. Milestone Map

| Milestone | 설명 | Tasks | 우선순위 |
| --- | --- | --- | --- |
| **P6-M1 Column Quick Add** | column별 빠른 task 생성 | T6-101 ~ T6-103 | P0 |
| **P6-M2 Status Action Menu** | 카드 메뉴에서 status 빠른 변경 | T6-201 ~ T6-203 | P0 |
| **P6-M3 Inline Remarks Editing** | 카드에서 `비고`만 가볍게 수정 | T6-301 ~ T6-304 | P1 |
| **P6-M4 Collapsible Columns** | 5개 column board 밀도 제어 | T6-401 ~ T6-404 | P1 |
| **P6-M5 Validation & Docs** | 테스트, QA, 문서 반영 | T6-501 ~ T6-504 | P0/P1 |

## 3. P6-M1 Column Quick Add

### T6-101 — column quick add UI
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T5-101, T5-104
- **Outputs**: `KanbanColumn` quick add control, i18n strings, UI tests
- **Why**: 5개 status가 생기면서 New task modal에서 status를 고르는 비용이 커졌다. 사용자가 보고 있는 column에 바로 추가할 수 있으면 capture가 더 빨라진다.
- **Done when**:
  - [x] 각 desktop column header에 compact `+` action이 있다.
  - [x] action을 누르면 해당 column status가 기본값인 task 입력 UI가 열린다.
  - [x] 입력 UI는 title을 우선 받고, 필요하면 기존 New task modal로 상세 입력을 이어갈 수 있다.
  - [x] 빈 title은 저장하지 않는다.
  - [x] 생성된 task는 해당 column 끝에 추가된다.

### T6-102 — quick add keyboard and focus behavior
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T6-101
- **Outputs**: focus management, keyboard tests
- **Why**: 빠른 추가 기능은 반복 입력에서 keyboard 흐름이 끊기면 가치가 줄어든다.
- **Done when**:
  - [x] quick add input은 열릴 때 자동 focus된다.
  - [x] Enter로 생성, Escape로 취소된다.
  - [x] 생성 성공 후 input을 유지할지 닫을지 일관된 정책을 적용한다.
  - [x] screen reader가 어느 status에 추가하는 입력인지 알 수 있다.

### T6-103 — mobile quick add parity
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T6-101
- **Outputs**: `MobileBoard` quick add action, mobile UI tests/manual QA
- **Why**: 모바일에서는 status tab context가 명확하므로 active tab에 바로 task를 추가하는 흐름이 잘 맞는다.
- **Done when**:
  - [x] active mobile status tab에 task를 추가할 수 있다.
  - [x] soft keyboard가 열린 상태에서도 save/cancel action이 가려지지 않는다.
  - [x] active tab과 생성 task status가 항상 일치한다.

## 4. P6-M2 Status Action Menu

### T6-201 — desktop card status menu
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T5-103
- **Outputs**: `KanbanCard` status menu, UI tests
- **Why**: 5개 column에서는 drag distance가 길어지고, keyboard shortcut을 모르는 사용자는 status 변경 경로가 불명확할 수 있다.
- **Done when**:
  - [x] desktop card menu에서 status를 다른 4개 status 중 하나로 변경할 수 있다.
  - [x] 현재 status는 선택됨 또는 disabled 상태로 표시한다.
  - [x] status 변경은 기존 `TaskService.moveTask` 경로를 사용한다.
  - [x] 변경 후 카드가 target column으로 이동한다.
  - [x] menu click은 card open action을 트리거하지 않는다.

### T6-202 — mobile card status menu
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T6-201
- **Outputs**: `MobileBoard` status menu, UI tests
- **Why**: mobile next/previous 버튼은 인접 status 이동에는 좋지만, HOLD에서 IN REVIEW처럼 멀리 이동할 때는 여러 번 눌러야 한다.
- **Done when**:
  - [x] mobile card menu에서 임의 status로 바로 이동할 수 있다.
  - [x] 기존 next/previous 버튼은 유지한다.
  - [x] menu label은 5단계 status display label과 일치한다.

### T6-203 — status menu accessibility
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T6-201, T6-202
- **Outputs**: keyboard/a11y tests, manual QA update
- **Why**: status 변경은 task 의미 데이터 변경이므로 keyboard와 screen reader에서 명확해야 한다.
- **Done when**:
  - [x] status menu action들은 keyboard로 실행 가능하다.
  - [x] 현재 status와 target status가 accessible name에 포함된다.
  - [x] 변경 후 focus가 예측 가능한 위치에 남는다.

## 5. P6-M3 Inline Remarks Editing

### T6-301 — inline remarks edit entry point
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T5-201, T5-301
- **Outputs**: `KanbanCard` remarks edit action, UI tests
- **Why**: `비고`는 카드에서 바로 확인하는 짧은 속성인데, 수정할 때마다 전체 Edit task modal을 여는 것은 무겁다.
- **Done when**:
  - [x] remarks 영역 또는 card menu에서 `비고`만 수정하는 경로가 있다.
  - [x] remarks가 없을 때도 `비고 추가` action을 찾을 수 있다.
  - [x] Jira key, title, project, priority는 이 inline flow에서 수정하지 않는다.

### T6-302 — inline remarks editor behavior
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T6-301
- **Outputs**: inline editor component, service tests/UI tests
- **Why**: inline editor는 작아도 저장/취소/no-op 처리가 명확해야 데이터 손실 느낌이 없다.
- **Done when**:
  - [x] editor는 plain textarea/input으로 제공한다.
  - [x] Enter 또는 explicit save로 저장하고 Escape/cancel로 닫는다.
  - [x] 빈 값 저장은 `remarks: null`로 처리한다.
  - [x] 변경이 없으면 disk write를 하지 않는다.
  - [x] 저장은 `TaskService.updateTask` 또는 `setRemarks`를 사용한다.

### T6-303 — mobile inline remarks editing
- **Status**: ✅ done (2026-05-15)
- **Priority**: P2
- **Dependencies**: T6-302
- **Outputs**: mobile editor behavior, manual QA
- **Why**: 모바일에서 inline 편집은 keyboard와 화면 높이 영향을 크게 받는다.
- **Done when**:
  - [x] mobile에서는 card menu action으로 remarks editor를 연다.
  - [x] soft keyboard가 editor save/cancel controls를 가리지 않는다.
  - [x] editor가 열린 동안 next/previous status button과 충돌하지 않는다.

### T6-304 — inline edit conflict and feedback
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T6-302
- **Outputs**: notice/role status handling, tests
- **Why**: inline 저장은 짧은 액션이라 실패했을 때 사용자가 저장 여부를 놓치기 쉽다.
- **Done when**:
  - [x] 저장 중/저장됨/실패 상태가 작게 표시된다.
  - [x] 실패 시 사용자가 입력한 text는 사라지지 않는다.
  - [x] 기존 conflict detection 정책을 우회하지 않는다.

## 6. P6-M4 Collapsible Columns

### T6-401 — desktop column collapse controls
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T5-102
- **Outputs**: `KanbanColumn` collapse UI, store/UI state, tests
- **Why**: 5개 column은 desktop에서도 가로 공간을 많이 쓰며, HOLD/DONE처럼 자주 보지 않는 column은 접어둘 수 있으면 board scan이 쉬워진다.
- **Done when**:
  - [x] 각 desktop column을 접고 펼 수 있다.
  - [x] 접힌 column은 title, count, expand action만 표시한다.
  - [x] 접힘 상태는 task data나 board order를 변경하지 않는다.
  - [x] 접힌 column으로 drag/drop할 수 있는 정책을 정하고 일관되게 구현한다.

### T6-402 — collapsed state persistence
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T6-401
- **Outputs**: plugin settings or local state persistence, tests
- **Why**: 사용자가 매번 HOLD/DONE을 다시 접어야 하면 밀도 제어 기능의 가치가 줄어든다.
- **Done when**:
  - [x] column collapsed state가 reload 후에도 유지된다.
  - [x] 저장 위치는 vault semantic data와 분리한다.
  - [x] 새 status가 추가되거나 unknown state가 있어도 안전하게 fallback한다.

### T6-403 — mobile column density policy
- **Status**: ✅ done (2026-05-15)
- **Priority**: P2
- **Dependencies**: T6-401
- **Outputs**: mobile UX decision, implementation/tests if needed
- **Why**: 모바일은 column 대신 tab UI라 desktop collapse를 그대로 복제하면 오히려 복잡해질 수 있다.
- **Done when**:
  - [x] mobile에서는 collapse를 제공할지, tab count만 유지할지 결정한다.
  - [x] 제공한다면 active tab 전환과 충돌하지 않는다.
  - [x] 제공하지 않는다면 desktop-only 정책을 진행 메모에 명시한다.

### T6-404 — collapsed column accessibility
- **Status**: ✅ done (2026-05-15)
- **Priority**: P1
- **Dependencies**: T6-401
- **Outputs**: a11y tests/manual QA
- **Why**: 접힘 상태는 screen reader와 keyboard 사용자에게 현재 보드 구조를 숨길 수 있다.
- **Done when**:
  - [x] collapse button에 expanded/collapsed state가 전달된다.
  - [x] 접힌 column의 task count를 screen reader가 알 수 있다.
  - [x] keyboard로 collapse/expand 후 focus 위치가 예측 가능하다.

## 7. P6-M5 Validation & Docs

### T6-501 — service and selector regression tests
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: T6-101, T6-201, T6-302, T6-401
- **Outputs**: service/store tests
- **Done when**:
  - [x] quick add가 target status로 task를 생성한다.
  - [x] status menu가 `moveTask` 경로로 status를 변경한다.
  - [x] inline remarks edit가 `remarks`만 변경한다.
  - [x] column collapse state가 board/task semantic data와 분리된다.

### T6-502 — UI and accessibility regression tests
- **Status**: planned
- **Priority**: P1
- **Dependencies**: P6-M1 ~ P6-M4
- **Outputs**: UI tests, manual QA doc update
- **Done when**:
  - [ ] quick add, status menu, remarks editor, collapse controls가 keyboard로 운용된다.
  - [ ] desktop 5-column board에서 controls가 겹치지 않는다.
  - [ ] mobile soft keyboard 시나리오가 확인된다.
  - [ ] screen reader label이 status와 action intent를 명확히 전달한다.

### T6-503 — docs update
- **Status**: planned
- **Priority**: P1
- **Dependencies**: implemented P6 tasks
- **Outputs**: README/PRD/HLD/manual docs updates
- **Done when**:
  - [ ] README에 column quick add, status menu, inline remarks edit, collapsible columns가 반영된다.
  - [ ] HLD에 board UI state와 semantic task data의 분리 원칙이 반영된다.
  - [ ] manual QA 문서에 desktop/mobile 시나리오가 추가된다.

### T6-504 — release verification
- **Status**: ✅ done (2026-05-15)
- **Priority**: P0
- **Dependencies**: P6-M1 ~ P6-M4 complete
- **Outputs**: typecheck/test/lint/build
- **Done when**:
  - [x] `npm run typecheck`
  - [x] `npm test`
  - [x] `npm run lint`
  - [x] `npm run build`

## 8. 진행 메모

- 2026-05-15: T6-101 ~ T6-404 구현 완료. Desktop/mobile quick add, status menu, inline remarks edit, desktop column collapse를 추가했다.
- 2026-05-15: Column collapse state는 plugin settings의 `collapsedColumns`에 저장하며 board/task semantic data와 분리했다.
- 2026-05-15: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` 통과.
- 남은 문서 작업: T6-502 manual QA update, T6-503 README/PRD/HLD/manual docs 반영.
