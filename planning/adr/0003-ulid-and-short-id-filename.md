# ADR-0003: ULID 기반 ID와 short ID 파일명

## Date

2026-05-10

## Context

모든 영속 entity (task, meeting, project)는 안정적인 식별자가 필요하다. 식별자는 다음 요건을 만족해야 한다.

- 사용자가 파일명을 바꿔도 entity 매칭이 깨지지 않아야 함.
- 두 device에서 동시에 새 entity를 만들어도 충돌 가능성이 매우 낮아야 함.
- 사람이 읽을 때 부담스럽지 않아야 함 (file explorer에서 100자 hash가 나오면 안 됨).

후보는 UUID v4(36자 hex), ULID(26자 Crockford Base32, 시간 정렬 가능), NanoID(configurable 길이), timestamp + counter 넷이다.

## Decision

**ULID를 사용하며, prefix로 entity 종류를 표현한다. 파일명에는 ULID 앞 8자만 노출한다.**

```
frontmatter id: task_01HX7SM2J6K4XQ7EV6C8T92PPW
파일명 short ID: task_01HX7SM2
```

- short ID 충돌 시 9, 10, ... 자로 자동 확장. 결국 풀 ULID까지 늘어남.
- 파일명은 사람을 위한 보조이며, 실제 매칭은 항상 frontmatter `id` 풀 형식 기준.
- 파일 rename은 Phase 1에서 자동 수행하지 않음 (title 변경 시 heading만 갱신).

## Alternatives Considered

| 옵션 | 장점 | 단점 | 탈락 사유 |
| --- | --- | --- | --- |
| A. UUID v4 | 표준이며 어디서나 동작 | 36자가 파일명에 그대로 들어가면 시각적 노이즈가 큼. 시간 정렬 불가 | file explorer가 직관적이지 않다 |
| B. NanoID 짧은 길이 | 가장 짧음 (8~12자도 가능) | 시간 정렬 안 됨 | 충돌 가능성을 ULID 수준으로 낮추려면 결국 비슷한 길이가 된다 |
| C. timestamp + counter | 매우 짧음 | 두 device 동시 생성 시 충돌 가능 | 충돌을 피하려고 device ID를 추가하면 결국 ULID와 비슷해진다 |
| D. 파일명에 풀 ULID | short ID 충돌 처리 로직이 필요 없음 | file explorer 가독성이 매우 떨어짐 | 사용자의 인지 부담이 크다 |

## Consequences

- **긍정적**: 시간 정렬이 가능하다(ULID는 첫 10자가 timestamp). 두 device 동시 생성 시 충돌 가능성이 매우 낮다(80 bit randomness). 파일명이 짧고 직관적이다(`웹사이트 리뉴얼 - task_01HX7SM2.md`).
- **부정적**: short ID 충돌 처리 로직이 필요하다(드물지만 가능). `ulid` 라이브러리 의존성이 추가된다.
- **리스크**: short ID가 충돌하면 파일명이 길어져 가독성 이점이 줄어든다. 완화 — 충돌 처리는 자동 길이 확장 알고리즘으로 단순화하고, 생성 함수는 단위 테스트로 검증한다(PRD §10.7). `ulid` npm 패키지는 ~1KB로 번들 영향이 미미하다.
- **검증**: ULID 1만 개 생성 후 앞 8자 충돌 빈도 측정(이론상 매우 낮음, 실측으로도 확인). short ID 충돌 시 자동 확장 로직 단위 테스트. 사용자가 파일명을 직접 변경해도 entity 매칭이 frontmatter `id` 기준으로 유지되는지 수동 QA.

## References

- 관련 문서: PRD §9.5, §10.7, PLAN §5
