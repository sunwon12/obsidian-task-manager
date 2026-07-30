# ADR-0009: Phase 1 모바일은 dnd 미사용, 명시적 액션 버튼만

- **Status**: Accepted
- **Date**: 2026-05-10
- **Deciders**: 제품/엔지니어링
- **Related**: PRD §8.2, §13.6, PLAN §14

## Context

dnd-kit은 데스크탑에서 우수하지만 모바일에서는 다음 한계가 알려져 있다.

- touch sensor가 page scroll과 충돌 (drag을 시작했는데 화면이 같이 스크롤됨).
- long-press 활성화 지연이 있어 사용자가 "버그"로 인지.
- 좁은 viewport에서 column 사이 drop target이 너무 좁음.
- iOS Obsidian의 메모리 제약 환경에서 dnd-kit의 추가 reactivity가 끊김 발생.

Phase 1은 "아키텍처가 동작하는지 검증"이 목표이므로, 모바일에서 high-friction 경험을 디버깅하는 데 시간을 쓰지 않기로 한다.

## Decision

**Phase 1 모바일은 dnd를 제공하지 않는다. 카드 이동은 명시적 액션 버튼으로 한다.**

- 좁은 viewport (< 768px)는 status tab + 단일 column grouped list 레이아웃.
- 카드 우측에 "다음 status로 이동" 화살표 버튼 노출.
- 카드 컨텍스트 메뉴(long-press 또는 ⋮ 버튼)에서 "이전 status로 이동", "Archive", "Delete".
- Tablet (≥ 768px) 부터는 desktop과 동일한 가로 column + dnd 제공.

dnd-kit 자체는 데스크탑 빌드에 필요하므로 dependency는 그대로 유지하되, 모바일 component에서는 dnd context를 mount하지 않는다.

## Alternatives Considered

### A. dnd 제공 + 모바일 한계 받아들임

장점: feature parity.

거부 이유: 사용자가 첫 사용에서 "이거 안 되네" 경험을 하면 다시 안 옴. high-friction 경험을 안 주는 게 안 주는 것보다 낫다.

### B. dnd 대체 라이브러리 (react-beautiful-dnd 등)

장점: 일부 라이브러리는 모바일이 더 나음.

거부 이유: 데스크탑 dnd-kit과 모바일 다른 라이브러리 두 개를 유지하는 비용. 라이브러리간 동작 차이로 mental model 분기.

### D. 모바일에서 long-press → modal로 status 선택

장점: 가능한 경험.

거부 이유: 액션 버튼 한 번 vs long-press + modal 선택 두 단계. 액션 버튼이 더 빠르고 명확.

## Consequences

### Positive

- 모바일에서 즉각적이고 예측 가능한 UX.
- dnd touch sensor 디버깅 시간을 Phase 1에서 절약.
- 액션 버튼은 a11y에도 자연스러움 (키보드/screen reader 호환).

### Negative

- 데스크탑과 모바일의 인터랙션 모델이 다름 (사용자가 두 가지를 학습).
- 한 번에 여러 카드를 정렬하는 데스크탑 dnd 경험을 모바일에서 못 함.

### Mitigation

- 액션 버튼 디자인을 명확하게 해 사용자가 즉시 발견할 수 있게 함.
- Phase 4에서 모바일 dnd를 별도로 검토 (PRD §14.4).

## Validation

- iOS Obsidian과 Android Obsidian에서 status tab 전환과 액션 버튼 동작 확인 (수동 QA checklist).
- 모바일에서 view를 5회 open/close 반복 시 메모리 leak 없는지 확인.
