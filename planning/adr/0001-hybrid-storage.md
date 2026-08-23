# ADR-0001: Markdown source-of-truth + JSON cache의 hybrid storage

## Date

2026-05-10

## Context

TaskMaster는 Obsidian 안에서 동작하는 칸반 작업 관리 플러그인이다. 데이터를 어디에 저장할지가 가장 근본적인 architectural 결정이다. 후보는 셋이다.

1. 모든 데이터를 Markdown으로만 저장
2. 모든 데이터를 JSON으로만 저장 (`.obsidian/plugins/<id>/`)
3. 의미 데이터는 Markdown, 캐시·시각 데이터는 JSON으로 분리한 hybrid

Obsidian 사용자의 핵심 가치는 **로컬 파일 소유와 장기 보관성**이다. 동시에 칸반 UI는 빠른 렌더링과 빈번한 카드 이동을 요구한다. 두 요구는 단일 저장소로는 동시에 만족하기 어렵다.

## Decision

**Hybrid storage 모델을 채택한다.**

- task, meeting, project, action item 등 사용자가 오래 보관해야 하는 의미 데이터는 frontmatter가 포함된 Markdown 파일에 저장한다.
- 시각 순서, 빠른 조회 인덱스, denormalized summary, UI 상태 같은 derived/cache 데이터는 JSON에 저장한다.
- JSON은 언제든 Markdown 스캔으로 재생성 가능해야 한다 (단, `.board.json`은 사용자의 시각 순서이므로 손상 시 결정적 알고리즘으로 회복).

판단 기준은 하나로 단순화한다 — **잃어도 회복 가능한가?** 그렇다면 JSON, 아니면 Markdown.

## Alternatives Considered

| 옵션 | 장점 | 단점 | 탈락 사유 |
| --- | --- | --- | --- |
| A. Markdown only | 가장 단순한 mental model. 모든 것이 Vault 안에서 보임. 백업·이식성 최고 | 카드 이동 1회마다 여러 Markdown 파일을 다시 써야 함. drag 같은 high-frequency 액션에서 disk I/O 폭발, conflict 가능성 상승 | "시각 순서"는 의미 데이터가 아닌데 매번 Vault에 commit하는 것은 가치 대비 비용이 높다 |
| B. JSON only | 빠르다. 단일 파일 하나만 다루므로 sync conflict 처리도 단순 | Markdown 노트로 task를 열거나 wikilink로 다른 노트와 연결할 수 없음 | Obsidian 사용자의 핵심 가치를 정면으로 위반한다. 이 플러그인을 쓸 이유가 사라진다 |
| C. Hybrid (채택) | 두 요구를 각자 맞는 저장소로 나눔 | 두 저장소를 동기화해야 함 | — |

## Consequences

- **긍정적**: Markdown 노트가 그대로 Obsidian 생태계(검색, backlink, Dataview)에 노출된다. 사용자가 plugin을 삭제해도 Markdown은 남는다(vendor lock-in 없음). 시각 순서 같은 derived data는 빠르게 다룬다.
- **부정적**: 두 저장소를 동기화해야 하므로 drift 가능성이 생긴다. 어느 데이터가 어느 저장소에 가는지에 대한 boundary 결정을 매번 내려야 한다.
- **리스크**: drift가 누적되면 보드와 파일이 어긋난다. 완화 — 항상 Markdown이 의미 데이터의 source of truth임을 PRD §8.3에 못박고, JSON은 결정적 알고리즘으로 재생성 가능하게 설계한다(PRD §9.4). boundary 판단은 위 "잃어도 회복 가능한가?" 한 줄로 정한다.
- **검증**: cache 파일을 모두 삭제한 뒤 reload해 보드가 손실 없이 재구성되는지 확인(PRD §12.2 정량 지표). 사용자가 plugin을 비활성화한 뒤 Markdown 파일만으로 작업 이력을 복구할 수 있는지 수동 QA로 검증.

## References

- 관련 ADR: [ADR-0002](./0002-board-json-in-vault.md), [ADR-0004](./0004-immediate-flush-for-semantic-data.md), [ADR-0008](./0008-frontmatter-passthrough.md)
- 관련 문서: PRD §8.3, §9, PLAN §4
