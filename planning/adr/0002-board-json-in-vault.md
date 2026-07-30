# ADR-0002: `.board.json`을 Vault 안에 두어 device 간 sync 지원

- **Status**: Accepted
- **Date**: 2026-05-10
- **Deciders**: 제품/엔지니어링
- **Related**: PRD §9.1, §9.4, ADR-0001

## Context

ADR-0001로 시각 순서를 JSON에 저장하기로 결정했다. 다음 질문은 **그 JSON 파일을 어디에 둘 것인가**이다.

후보:

1. `.obsidian/plugins/<id>/board.json` (plugin folder, Obsidian 표준 위치)
2. `[Vault]/TaskMaster/.board.json` (Vault 안)

플러그인 데이터의 표준 위치는 (1)이다. 그러나 **Obsidian Sync, Git, iCloud, Dropbox 등 대부분의 sync 도구는 `.obsidian/plugins/` 폴더를 기본 제외한다.** 결과적으로 device A에서 정한 카드 순서가 device B에 전달되지 않고, device 간 보드가 다르게 보인다.

이 사용자 경험은 "내 보드 순서가 사라졌다"는 인지적 실패로 이어지며, 로컬 우선이라는 핵심 가치와는 별개로 신뢰성을 떨어뜨린다.

## Decision

**`.board.json`은 `[Vault]/TaskMaster/.board.json`에 둔다.**

- 시각 순서가 device 간에 sync된다.
- 파일명을 dotfile (`.board.json`)로 두어 file explorer에서 노이즈가 되지 않게 한다.
- `data.json`(in-memory index 캐시)과 `settings.json`(사용자 설정)은 device-local 정보이므로 plugin folder에 그대로 둔다.

Sync 도중 두 device가 같은 파일을 다른 순서로 저장한 경우의 conflict 해소 정책 (PRD §9.4):

1. 더 큰 `updatedAt`을 가진 쪽을 winner로 채택.
2. winner에 없지만 loser에 있는 taskId(상대 device의 새 task)는 해당 column 끝에 append.
3. 어느 쪽에도 없는 taskId는 PRD §9.4 재구성 알고리즘으로 보충.

## Alternatives Considered

### A. plugin folder 표준 위치 유지

장점: Obsidian convention과 정렬. plugin uninstall 시 자동 cleanup.

거부 이유: device 간 sync 안 됨. multi-device 사용자에게 핵심 기능 손상.

### B. plugin folder + 사용자가 sync 설정 직접

장점: 표준 위치 유지하면서 원하는 사용자만 sync.

거부 이유: 사용자에게 환경 설정 부담을 떠넘긴다. 기본값으로 동작이 잘못되는 것은 안 된다.

### C. Vault 안에 두되 dotfile 아닌 일반 파일

장점: file explorer에서 보임, 사용자가 인지 가능.

거부 이유: 매번 file explorer에서 노이즈가 됨. plugin이 관리하는 파일을 사용자가 직접 편집할 일은 없으므로 hidden이 적절.

## Consequences

### Positive

- 기본값으로 multi-device 경험이 일관됨.
- conflict 해소 정책이 명시적으로 결정되어 있음 (애매한 silent overwrite 없음).

### Negative

- Vault 안의 dotfile이 일부 sync 도구(Dropbox 등)에서 충돌 marker를 남길 수 있음.
- `.board.json` 자체에 sync conflict가 발생할 수 있음 (이전엔 plugin folder 단위 isolation으로 회피했던 risk).
- plugin uninstall 후에도 `.board.json` 파일이 Vault에 남음.

### Mitigation

- conflict 해소 정책을 PRD §9.4에 명시.
- merged 결과가 이상해도 사용자 데이터는 손실되지 않음 (taskId append 정책).
- uninstall 정책은 Phase 2에서 cleanup helper command 추가 검토.

## Validation

- 두 device에서 같은 Vault를 sync한 뒤 각자 다른 카드 순서로 변경 → conflict 해소가 양쪽 task를 모두 보존하는지 확인.
- `.board.json` 삭제 후 reload → PRD §9.4 결정적 재구성으로 복구되는지 확인.
