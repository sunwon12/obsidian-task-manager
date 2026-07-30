# TaskMaster Phase 4 Tasks

- **Version**: 0.1
- **Date**: 2026-05-11
- **Source docs**: [PRD](PRD.md), [HLD](HLD.md), [TASKS2](TASKS2.md), [TASK3](TASK3.md)
- **Phase theme**: project workspace activation

## 1. Phase 4 방향

Timeline/WBS view를 제거한 뒤, Phase 4는 새로운 대형 view를 추가하지 않고 Project context 안에서 task, memo, meeting이 더 자연스럽게 이어지도록 만든다.

핵심 원칙:

- Project memo는 기본 접힘 상태를 유지해 board를 방해하지 않는다.
- Project memo, task, meeting 사이에는 Obsidian wikilink/block link를 남겨 추적 가능하게 한다.
- 회의록은 생성에서 끝나지 않고 action item과 task 생성 흐름으로 이어진다.
- 자동 분류나 LLM extraction은 나중으로 미루고, 먼저 명시적 사용자 액션 중심으로 구현한다.

비목표:

- Timeline/Gantt/WBS view 재도입.
- task schema에 due date 또는 schedule field 추가.
- LLM 기반 action item 자동 추출.
- 복잡한 project dashboard.

## 2. Milestone Map

| Milestone | 설명 | Tasks | 우선순위 |
| --- | --- | --- | --- |
| **P4-M1 Linkable Project Workspace** | memo/task/meeting 간 추적성 강화 | T4-101 ~ T4-103 | P0 |
| **P4-M2 Meeting Follow-up Flow** | 회의록 action item을 task로 전환 | T4-201 ~ T4-203 | P1 |
| **P4-M3 Faster Capture** | 빠른 task/memo 입력 흐름 개선 | T4-301 ~ T4-303 | P1 |
| **P4-M4 Validation & Docs** | QA, 문서, 접근성 검증 | T4-401 ~ T4-403 | P0/P1 |

## 3. P4-M1 Linkable Project Workspace

### T4-101 — memo to task backlink
- **Status**: ✅ done (2026-05-11)
- **Priority**: P0
- **Dependencies**: T2-201
- **Outputs**: `ProjectMemoService`, `ProjectMemoActions`, tests
- **Why**: quick memo를 task로 전환한 뒤 원본 memo에는 생성된 task 흔적이 남지 않아 중복 변환과 추적 누락이 생길 수 있다.
- **Done when**:
  - [x] memo에서 task 생성 시 원본 memo 아래에 `Task: [[...]]` wikilink가 추가된다.
  - [x] task body에는 기존 source memo link가 유지된다.
  - [x] 같은 task link를 중복으로 남기지 않는다.
  - [x] memo preview/action text는 plugin-generated backlink를 memo 본문으로 오인하지 않는다.
  - [x] service/UI 테스트가 추가된다.

### T4-102 — project activity feed
- **Status**: planned
- **Priority**: P1
- **Dependencies**: T4-101
- **Outputs**: `ProjectActivityFeed` component, selectors/tests
- **Why**: 프로젝트 화면에서 최근 memo만 보이고 최근 task/meeting 흐름이 보이지 않아 project workspace 감각이 약하다.
- **Done when**:
  - [ ] selected project의 최근 memo, task, meeting을 compact feed로 보여준다.
  - [ ] feed는 memo area 안에 위치하거나 별도 compact row로 제공한다.
  - [ ] 기본 board scan을 무겁게 만들지 않는다.
  - [ ] empty state가 과하게 공간을 차지하지 않는다.

### T4-103 — recent meeting shortcuts
- **Status**: planned
- **Priority**: P1
- **Dependencies**: T2-304
- **Outputs**: project context meeting preview/open action
- **Why**: meeting note를 만든 뒤 프로젝트 화면에서 다시 찾기 어렵다.
- **Done when**:
  - [ ] selected project의 최근 meeting 2~3개를 보여준다.
  - [ ] 클릭하면 meeting note를 Obsidian editor에서 연다.
  - [ ] 좁은 화면에서 project header가 과밀해지지 않는다.

## 4. P4-M2 Meeting Follow-up Flow

### T4-201 — meeting action item parser
- **Status**: planned
- **Priority**: P1
- **Dependencies**: T2-304
- **Outputs**: meeting action item parser helper, tests
- **Why**: 회의록의 `## Action Items` 섹션이 있지만 task 생성 흐름과 연결되어 있지 않다.
- **Done when**:
  - [ ] `## Action Items` 아래 checkbox/bullet item을 안전하게 읽는다.
  - [ ] 이미 완료된 checkbox는 기본 변환 후보에서 제외한다.
  - [ ] Markdown body와 frontmatter passthrough를 보존한다.

### T4-202 — action item to task command/UI
- **Status**: planned
- **Priority**: P1
- **Dependencies**: T4-201
- **Outputs**: meeting follow-up service/UI, tests
- **Why**: 회의 후 후속 task를 수동으로 다시 입력하는 마찰을 줄인다.
- **Done when**:
  - [ ] meeting note의 action item을 task로 만들 수 있다.
  - [ ] 생성된 task body에 source meeting link가 들어간다.
  - [ ] meeting note의 action item 아래에 생성 task link를 남긴다.

### T4-203 — meeting flow manual QA
- **Status**: planned
- **Priority**: P1
- **Dependencies**: T4-202
- **Outputs**: manual QA doc update
- **Why**: meeting note는 사용자가 직접 Markdown을 편집할 가능성이 높아 수동 검증이 필요하다.
- **Done when**:
  - [ ] 직접 편집된 action item section에서도 변환이 안전하다.
  - [ ] sync conflict 시 task/memo와 같은 보존 원칙을 따른다.

## 5. P4-M3 Faster Capture

### T4-301 — compact quick task input
- **Status**: planned
- **Priority**: P1
- **Dependencies**: (none)
- **Outputs**: board/project context quick task input, tests
- **Why**: `+ New task` modal은 안정적이지만 반복 capture에는 한 박자 느리다.
- **Done when**:
  - [ ] 제목만 입력하고 Enter로 task를 생성할 수 있다.
  - [ ] selected project가 있으면 자동으로 project가 지정된다.
  - [ ] 빈 title은 저장하지 않는다.
  - [ ] 기존 modal은 상세 입력용으로 유지한다.

### T4-302 — project memo expanded preview controls
- **Status**: planned
- **Priority**: P2
- **Dependencies**: T4-101
- **Outputs**: memo preview expand/more controls
- **Why**: 최근 3개 preview는 가볍지만, 사용자가 “오늘 메모”를 조금 더 보고 싶을 때 project note를 열어야 한다.
- **Done when**:
  - [ ] memo area가 펼쳐진 상태에서 최근 memo 표시 개수를 늘릴 수 있다.
  - [ ] 긴 memo는 필요할 때만 확장한다.
  - [ ] 기본 접힘 정책은 유지한다.

### T4-303 — mobile capture polish
- **Status**: planned
- **Priority**: P2
- **Dependencies**: T4-301
- **Outputs**: mobile QA updates, UI tweaks
- **Why**: 모바일에서는 capture UI가 조금만 커져도 board 탐색을 방해한다.
- **Done when**:
  - [ ] quick task/memo controls가 soft keyboard와 겹치지 않는다.
  - [ ] tap target이 충분하다.
  - [ ] project context가 세로 공간을 과하게 차지하지 않는다.

## 6. P4-M4 Validation & Docs

### T4-401 — docs update
- **Status**: planned
- **Priority**: P0
- **Dependencies**: implemented P4 tasks
- **Outputs**: README/PRD/HLD updates
- **Done when**:
  - [ ] 사용자-facing README가 실제 기능과 일치한다.
  - [ ] PRD/HLD에 Phase 4 방향과 비목표가 반영된다.

### T4-402 — accessibility regression check
- **Status**: planned
- **Priority**: P1
- **Dependencies**: T4-101, T4-301
- **Outputs**: tests/manual update
- **Done when**:
  - [ ] 새 버튼/입력창이 keyboard로 운용된다.
  - [ ] collapsed/expanded state가 screen reader에 전달된다.

### T4-403 — release verification
- **Status**: planned
- **Priority**: P0
- **Dependencies**: P4-M1 complete
- **Outputs**: typecheck/test/lint/build
- **Done when**:
  - [ ] `npm run typecheck`
  - [ ] `npm test`
  - [ ] `npm run lint`
  - [ ] `npm run build`

## 7. 진행 메모

- 먼저 T4-101을 끝내서 memo/task 추적성을 보강한다.
- 그 다음 T4-102/T4-103으로 project context를 activity-oriented하게 확장한다.
- Meeting follow-up은 명시적 action item 변환부터 시작한다.
