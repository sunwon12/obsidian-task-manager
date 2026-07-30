# TaskMaster Phase 7 Tasks

- **Version**: 0.1
- **Date**: 2026-05-15
- **Source docs**: [PRD](PRD.md), [HLD](HLD.md), [TASK6](TASK6.md)
- **Phase theme**: status visibility chips

## 1. Phase 7 방향

Phase 6의 desktop column collapse는 5단계 보드 밀도를 낮추는 데는 도움이 되지만, 접힌 column이 세로 막대로 남아 화면을 계속 차지하고 각 column header에 `-` action이 반복되어 보드가 다소 복잡해진다.

Phase 7은 column별 collapse UI를 제거하고, 칸반보드 바로 위에 status visibility chip bar를 둔다. 사용자는 `HOLD`, `TODO`, `DOING`, `IN REVIEW`, `DONE` 다섯 가지 상태를 rounded-full chip button으로 켜고 끌 수 있다. 꺼진 status는 접힌 막대나 placeholder 없이 보드에서 완전히 숨긴다.

핵심 원칙:

- status visibility는 보드 전체 시야를 제어하는 UI 상태다.
- 꺼진 status column은 세로 막대, 빈 column, drop zone 없이 아예 렌더링하지 않는다.
- chip은 `rounded-full` button 형태로 제공한다.
- 최소 1개 status는 항상 켜져 있어야 한다.
- task의 `status`, board order, task frontmatter는 visibility toggle로 변경하지 않는다.
- Phase 6의 quick add, status action menu, inline remarks edit는 유지한다.

비목표:

- status별 WIP limit.
- saved view preset.
- stale/idle age 표시.
- HOLD reason 입력 유도.
- 수동 정렬/최신순 정책 재설계.

## 2. Milestone Map

| Milestone | 설명 | Tasks | 우선순위 |
| --- | --- | --- | --- |
| **P7-M1 Visibility State Model** | collapse state를 hidden status state로 전환 | T7-101 ~ T7-103 | P0 |
| **P7-M2 Status Chip Bar** | 보드 상단 rounded-full visibility chips | T7-201 ~ T7-204 | P0 |
| **P7-M3 Remove Collapsed Columns** | 세로 막대 collapse UI 제거 | T7-301 ~ T7-303 | P0 |
| **P7-M4 Mobile Visibility UX** | 모바일 status tab과 visibility 정책 정리 | T7-401 ~ T7-403 | P1 |
| **P7-M5 Validation & Docs** | 테스트, QA, 문서 반영 | T7-501 ~ T7-504 | P0/P1 |

## 3. P7-M1 Visibility State Model

### T7-101 — replace collapsedColumns with hiddenStatuses
- **Status**: done
- **Priority**: P0
- **Dependencies**: T6-401, T6-402
- **Outputs**: settings type/migration, repository tests
- **Why**: `collapsedColumns`는 접힌 column을 화면에 남기는 모델이라, “꺼진 status는 아예 안 보이게 한다”는 새 UX와 이름/동작이 맞지 않는다.
- **Done when**:
  - [x] `PluginSettings`에 `hiddenStatuses: ColumnId[]`를 추가한다.
  - [x] 기존 `collapsedColumns` settings가 있으면 `hiddenStatuses`로 migration한다.
  - [x] `collapsedColumns`는 runtime state에서 제거하거나 더 이상 사용하지 않는다.
  - [x] unknown status 값은 migration 중 버린다.
  - [x] hidden 상태는 task/board semantic data와 분리된다.

### T7-102 — visible status selector
- **Status**: done
- **Priority**: P0
- **Dependencies**: T7-101
- **Outputs**: visible status helper/selector, tests
- **Why**: 여러 UI가 status visibility를 사용할 때 최소 1개 visible 정책과 order 보존을 한 곳에서 관리해야 한다.
- **Done when**:
  - [x] `TASK_STATUS_ORDER` 순서대로 visible statuses를 계산한다.
  - [x] 모든 status가 hidden이 되려는 경우 마지막 visible status는 유지한다.
  - [x] hidden status의 task들은 store에서 사라지지 않고 view에서만 숨겨진다.

### T7-103 — settings save behavior
- **Status**: done
- **Priority**: P0
- **Dependencies**: T7-101, T7-102
- **Outputs**: settings save/update tests
- **Why**: visibility toggle은 자주 누를 수 있어 저장 동작이 안정적이어야 한다.
- **Done when**:
  - [x] chip toggle 시 `hiddenStatuses`가 settings에 저장된다.
  - [x] reload 후 hidden status 상태가 유지된다.
  - [x] settingsRevision 기반 UI refresh가 정상 동작한다.

## 4. P7-M2 Status Chip Bar

### T7-201 — desktop status visibility bar
- **Status**: done
- **Priority**: P0
- **Dependencies**: T7-101
- **Outputs**: `StatusVisibilityBar` component, UI tests
- **Why**: status 표시/숨김은 column header마다 흩어진 `-` 버튼보다 보드 상단의 전역 control이 더 이해하기 쉽다.
- **Done when**:
  - [x] Kanban board 바로 위에 status visibility chip bar가 있다.
  - [x] chip은 `HOLD`, `TODO`, `DOING`, `IN REVIEW`, `DONE` 순서로 표시된다.
  - [x] 각 chip은 `rounded-full` button 모양이다.
  - [x] active chip은 켜짐 상태가 시각적으로 명확하다.
  - [x] inactive chip은 꺼짐 상태가 시각적으로 명확하지만 여전히 클릭 가능하다.

### T7-202 — chip toggle interaction
- **Status**: done
- **Priority**: P0
- **Dependencies**: T7-201
- **Outputs**: toggle behavior, UI tests
- **Why**: 사용자는 status를 빠르게 켜고 끄면서 보드 밀도를 조절해야 한다.
- **Done when**:
  - [x] chip click으로 해당 status visibility가 toggle된다.
  - [x] 꺼진 status column은 보드에서 즉시 완전히 사라진다.
  - [x] 다시 켜면 원래 status order 위치에 column이 돌아온다.
  - [x] 마지막 visible status chip은 끌 수 없거나 no-op 처리된다.
  - [x] aria-pressed 또는 동등한 상태 정보가 전달된다.

### T7-203 — chip bar layout polish
- **Status**: done
- **Priority**: P1
- **Dependencies**: T7-201
- **Outputs**: responsive style updates
- **Why**: 다섯 개 chip은 한 줄에 들어가야 하지만 좁은 폭에서는 자연스럽게 감겨야 한다.
- **Done when**:
  - [x] desktop에서 chip bar가 board content와 겹치지 않는다.
  - [x] 좁은 pane에서는 chip들이 wrap되거나 horizontal scroll로 깨지지 않는다.
  - [x] chip text가 button 안에서 잘리지 않는다.

### T7-204 — quick add with hidden statuses
- **Status**: done
- **Priority**: P0
- **Dependencies**: T7-202, T6-101
- **Outputs**: quick add integration tests
- **Why**: hidden status의 column이 렌더링되지 않으면 그 column의 quick add도 사라져야 한다.
- **Done when**:
  - [x] visible status column에만 quick add가 표시된다.
  - [x] hidden status에는 column quick add가 보이지 않는다.
  - [x] New task modal과 card status menu에서는 hidden status도 선택 가능하다.

## 5. P7-M3 Remove Collapsed Columns

### T7-301 — remove per-column collapse controls
- **Status**: done
- **Priority**: P0
- **Dependencies**: T7-201
- **Outputs**: `KanbanColumn` cleanup, UI tests
- **Why**: 상단 chip bar가 visibility control을 담당하면 각 column header의 `-` button은 중복이고 시각적 잡음이 된다.
- **Done when**:
  - [x] column header의 collapse `-` button을 제거한다.
  - [x] collapsed vertical column UI를 제거한다.
  - [x] `KanbanColumn`은 visible column만 렌더링한다.
  - [x] hidden status는 DOM에 placeholder도 남기지 않는다.

### T7-302 — drag/drop behavior with hidden statuses
- **Status**: done
- **Priority**: P0
- **Dependencies**: T7-301
- **Outputs**: drag/drop tests
- **Why**: hidden status가 drop target으로 존재하지 않으면 drag/drop 정책이 단순해진다.
- **Done when**:
  - [x] hidden status column은 drop target으로 동작하지 않는다.
  - [x] visible status 간 drag/drop은 기존처럼 동작한다.
  - [x] hidden status로 이동하려면 card status menu를 사용한다.
  - [x] hidden status에 있던 task는 해당 status를 다시 켰을 때 나타난다.

### T7-303 — remove collapsed settings references
- **Status**: done
- **Priority**: P0
- **Dependencies**: T7-301
- **Outputs**: dead code cleanup, tests
- **Why**: `collapsedColumns` 코드가 남아 있으면 새 hidden status 정책과 혼동될 수 있다.
- **Done when**:
  - [x] `collapsedColumns` UI 코드 참조가 제거된다.
  - [x] `Collapse/Expand column` i18n key가 더 이상 사용되지 않거나 정리된다.
  - [x] 기존 tests는 hidden status 기준으로 갱신된다.

## 6. P7-M4 Mobile Visibility UX

### T7-401 — mobile chip placement
- **Status**: done
- **Priority**: P1
- **Dependencies**: T7-201
- **Outputs**: mobile visibility UI, tests
- **Why**: 모바일은 status tab이 이미 있으므로 visibility chip을 어디에 둘지 명확히 정해야 한다.
- **Done when**:
  - [x] mobile board에도 rounded-full status visibility chips를 제공한다.
  - [x] chip bar는 status tab과 시각적으로 구분된다.
  - [x] hidden status tab은 보이지 않는다.
  - [x] active tab이 hidden되면 다음 visible status로 이동한다.

### T7-402 — mobile quick add with visible tabs
- **Status**: done
- **Priority**: P1
- **Dependencies**: T7-401, T6-103
- **Outputs**: mobile quick add tests
- **Why**: active tab이 visibility에 따라 바뀌면 quick add target도 항상 visible active status와 일치해야 한다.
- **Done when**:
  - [x] mobile quick add는 현재 visible active status로 task를 만든다.
  - [x] hidden status로 quick add가 생성되는 경로가 없다.
  - [x] hidden status를 다시 켜면 tab count가 정상 표시된다.

### T7-403 — mobile accessibility
- **Status**: done
- **Priority**: P1
- **Dependencies**: T7-401
- **Outputs**: a11y tests/manual QA
- **Why**: chip과 tab이 함께 있으면 screen reader 사용자가 둘의 역할을 구분할 수 있어야 한다.
- **Done when**:
  - [x] visibility chip bar와 status tablist의 accessible label이 다르다.
  - [x] chip은 pressed state를 전달한다.
  - [x] tab은 selected state를 전달한다.

## 7. P7-M5 Validation & Docs

### T7-501 — regression tests
- **Status**: done
- **Priority**: P0
- **Dependencies**: T7-101, T7-201, T7-301, T7-401
- **Outputs**: settings/UI tests
- **Done when**:
  - [x] hidden status migration 테스트가 있다.
  - [x] chip toggle 테스트가 있다.
  - [x] hidden status column이 DOM에서 사라지는 테스트가 있다.
  - [x] 마지막 visible status를 끄지 못하는 테스트가 있다.
  - [x] mobile active tab fallback 테스트가 있다.

### T7-502 — visual/manual QA
- **Status**: ready for manual QA
- **Priority**: P1
- **Dependencies**: P7-M2 ~ P7-M4
- **Outputs**: manual QA update
- **Done when**:
  - [ ] desktop에서 chip bar가 board 바로 위에 자연스럽게 위치한다.
  - [ ] rounded-full chip button style이 active/inactive 상태를 명확히 보여준다.
  - [ ] hidden status가 세로 막대 없이 완전히 사라진다.
  - [ ] mobile에서 chip과 tab이 겹치거나 혼동되지 않는다.

### T7-503 — docs update
- **Status**: done
- **Priority**: P1
- **Dependencies**: implemented P7 tasks
- **Outputs**: README/PRD/HLD/manual docs updates
- **Done when**:
  - [x] README에 status visibility chip bar 설명이 반영된다.
  - [x] HLD에 UI-only hidden status settings가 반영된다.
  - [x] manual QA 문서에 desktop/mobile visibility 시나리오가 추가된다.

### T7-504 — release verification
- **Status**: done
- **Priority**: P0
- **Dependencies**: P7-M1 ~ P7-M4 complete
- **Outputs**: typecheck/test/lint/build
- **Done when**:
  - [x] `npm run typecheck`
  - [x] `npm test`
  - [x] `npm run lint`
  - [x] `npm run build`

## 8. 진행 메모

- 먼저 `collapsedColumns`를 `hiddenStatuses`로 대체하고 migration을 넣는다.
- 그 다음 `StatusVisibilityBar`를 Kanban board 바로 위에 추가한다.
- hidden status는 column을 접지 않고 렌더링 대상에서 제외한다.
- chip은 `rounded-full` button 형태로 구현하고, 최소 1개 status는 항상 visible로 유지한다.
- 2026-05-15: 코드 구현과 자동 검증은 완료. T7-502의 실제 desktop/mobile 기기 visual QA는 manual checklist 기준으로 별도 실행 필요.
