# ADR-0004: 의미 데이터는 즉시 flush, 시각 데이터는 debounce

- **Status**: Accepted
- **Date**: 2026-05-10
- **Deciders**: 제품/엔지니어링
- **Related**: PRD §7.3, §10.2, §13.5, PLAN §7, §10, ADR-0001

## Context

칸반 보드는 high-frequency 액션이 많다. 사용자가 카드를 짧은 시간 안에 여러 번 옮기거나 column 안에서 reorder를 반복할 수 있다. 매번 Markdown 파일을 disk에 쓰면 두 가지 문제가 발생한다.

1. 과도한 disk I/O로 sync tool에 노이즈가 발생하고 conflict 가능성이 높아짐.
2. 사용자가 곧 다시 바꿀 의도라면 중간 상태를 굳이 디스크에 commit할 필요가 없음.

전통적인 해결책은 **debounce**다. 하지만 Obsidian은 다음 제약이 있다.

- `Plugin.onunload()`는 **promise return을 기다리지 않는다.** await flush()를 해도 Obsidian은 곧바로 plugin을 unload한다.
- 사용자가 Obsidian을 종료하거나 plugin을 비활성화하면 pending write가 사라질 수 있다.

debounce를 모든 write에 일괄 적용하면 의미 있는 변경(status, archive)이 손실될 수 있고, 즉시 flush로만 통일하면 reorder마다 disk write가 발생한다.

## Decision

**데이터의 손실 비용에 따라 정책을 분기한다.**

| 데이터 종류 | 정책 | 근거 |
| --- | --- | --- |
| status, archive, delete, title 등 의미 데이터 | 즉시 flush (no debounce) | 손실 시 회복 불가, onunload 손실 위험 차단 |
| 같은 column 안 reorder 등 시각 데이터 | debounce 500ms | 손실되어도 PRD §9.4 알고리즘으로 회복 가능 |

`onunload`는 sync 함수로 정의하고 `flush()`를 fire-and-forget으로 호출한다. 평소 정책으로 pending이 거의 없도록 만들었기 때문에 onunload가 promise를 기다리지 않아도 손실이 없다.

## Alternatives Considered

### A. 모든 write를 즉시 flush

장점: 손실 위험 zero. 정책 단순.

거부 이유: 카드 reorder 1초 동안 5번 일어나면 5번 모두 disk write. sync tool에 노이즈, 사용자가 인지 가능한 lag.

### B. 모든 write를 debounce

장점: I/O 최소화.

거부 이유: onunload sync 제약으로 의미 데이터가 손실 가능. 사용자가 status를 바꾸고 곧바로 Obsidian을 닫으면 그 변경이 사라짐.

### C. 모든 write를 debounce + onunload에서 sync flush 시도

장점: 비용과 안전성 둘 다.

거부 이유: Obsidian의 `Vault.modify()`는 inherently async이고 onunload는 promise를 안 기다림. 안전성을 보장할 수 없다.

## Consequences

### Positive

- 의미 데이터는 절대 손실되지 않음.
- 시각 데이터는 debounce로 disk I/O 최소화.
- 정책이 명확해 새 기능 추가 시 분기가 쉬움 ("이 변경은 잃어도 회복 가능한가?").

### Negative

- TaskRepository에 `saveImmediate`와 `queueSave` 두 가지 API가 존재.
- 새 기능 추가 시 어느 정책을 쓸지 매번 판단해야 함.

### Mitigation

- TaskService 메서드에서 정책을 결정해 React 쪽 호출자는 의식하지 않아도 됨.
- 기본은 `saveImmediate`. `queueSave`는 명시적으로 high-frequency가 입증된 경우만 사용.
- 코드 리뷰 체크리스트에 "이 변경은 손실되어도 회복 가능한가?" 항목 추가.

## Validation

- onunload 시점에 pending Markdown write가 0인지 단위 테스트로 검증.
- card drag 1초 동안 Vault write 호출이 task당 1회 이하인지 정량 측정 (PRD §10.2, §12.2).
