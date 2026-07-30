# TaskMaster Phase 3 Adjustment

- **Version**: 0.2
- **Date**: 2026-05-11
- **Status**: Timeline/WBS view removed

## 1. 결정

Phase 3에서 실험한 Timeline 형식은 실제 사용성이 낮다고 판단하여 제거한다.

제거 범위:

- Header의 Timeline view 전환.
- `viewMode: "timeline"`.
- Timeline 전용 React components.
- Timeline toolbar, date axis, task bar, unscheduled lane, bulk scheduling.
- task edit modal의 일정/마일스톤 입력.
- `startDate`, `dueDate`, `milestone` managed field.
- Timeline UI state settings.
- Timeline manual QA와 관련 자동 테스트.

보존 범위:

- Board / Archive view.
- Project memo, quick memo, meeting actions.
- Search, priority filter, hide completed.
- 기존 Markdown에 남아 있는 `startDate`, `dueDate`, `milestone` field는 unknown frontmatter passthrough로 보존한다.

## 2. 완료된 제거 작업

- [x] `src/ui/timeline/` 제거.
- [x] `tests/ui/timeline/` 제거.
- [x] `src/core/dateRange.ts` 제거.
- [x] Header에서 Timeline 버튼 제거.
- [x] App routing에서 Timeline branch 제거.
- [x] store/settings에서 `timelineView` 제거.
- [x] task parser/service/modal에서 scheduling managed field 제거.
- [x] Timeline 관련 i18n string 제거.
- [x] Timeline ADR와 README/PRD/HLD/PLAN references 정리.
- [x] 기존 scheduling frontmatter는 passthrough로 보존되도록 parser test 유지.

## 3. 후속 후보

Timeline 대신 필요하면 다음처럼 더 가벼운 planning UX를 검토한다.

- Project context 안의 compact checklist summary.
- Due-date 없는 단순 "Follow-up" task 묶음.
- Calendar/Gantt가 아닌 project memo 중심 planning flow.
- WBS가 필요하다면 날짜 축 없이 parent/child outline view로만 실험.

## 4. 진행 원칙

- Timeline 형식은 재도입하지 않는다.
- 일정 정보가 꼭 필요해지기 전까지 task frontmatter managed schema에 날짜 field를 추가하지 않는다.
- 사용성 실험은 먼저 작은 Project workspace affordance로 시작한다.
