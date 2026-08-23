# ADR-0011: Project quick memo는 project note append를 기본으로 한다

## Date

2026-05-11

## Context

Project quick memo는 사용자가 project를 진행하면서 떠오른 짧은 생각, 결정 전 메모, 링크, 후속 질문을 제목 없이 빠르게 남기는 기능이다. 초기 논의에서 memo마다 별도 page를 만드는 방식도 검토했지만, 빠른 입력의 마찰이 커지고 project 맥락이 여러 파일로 흩어질 위험이 있었다.

Phase 2 구현과 자동 테스트에서 확인한 핵심 사용 경로는 다음과 같다.

- selected project note의 `## Quick Notes` 아래에 즉시 append한다.
- 날짜 heading `### YYYY-MM-DD`로 묶고, 각 memo는 `HH:mm` bullet로 저장한다.
- 각 memo는 `^tm-memo-<ULID>` Obsidian block reference를 가진다.
- 같은 session에서 빠르게 연속 append해도 service queue로 손실 없이 저장한다.
- stale project write는 원본을 덮지 않고 conflicted copy로 남기며 Diagnostics에 기록한다.

## Decision

**Phase 2의 기본 storage는 selected project note append로 유지하고, 월간/주간 project log 파일 자동 분리는 실제 파일 성장 또는 sync conflict 패턴이 확인될 때 도입한다.**

- Quick memo 기본 저장 위치: `TaskMaster/Projects/{project}.md`의 `## Quick Notes`.
- Append 단위: `### YYYY-MM-DD` 아래 `- HH:mm memo text ^tm-memo-<ULID>`.
- Standalone note는 사용자가 명시적으로 "Promote note"를 실행할 때만 `TaskMaster/ProjectMemos/` 아래 생성한다.
- Promote된 note는 project note와 source memo block link를 모두 포함한다.
- 원본 memo에는 promoted note wikilink를 continuation line으로 남긴다.

## Alternatives Considered

| 옵션 | 장점 | 단점 | 탈락 사유 |
| --- | --- | --- | --- |
| A. memo마다 standalone note 자동 생성 | 각 memo가 Obsidian note로 즉시 독립되고 backlinks가 자연스러움 | 작은 memo가 파일 단위로 흩어져 project home note의 맥락성이 약해짐 | quick memo의 핵심인 "제목 없이 빠르게 쌓기"와 충돌한다 |
| B. 월간/주간 project log 파일에 바로 저장 | project note가 길어지는 문제와 sync conflict 위험을 줄임 | 첫 구현에서 파일 위치와 navigation이 복잡해짐 | 아직 memo 규모와 sync conflict 빈도에 대한 실제 사용 데이터가 부족하다 |
| C. TaskMaster 내부 JSON store에만 저장 | append·preview·query가 단순해짐 | Obsidian editor·search·backlinks와 단절됨 | TaskMaster의 source-of-truth는 Markdown이어야 한다는 [ADR-0001](./0001-hybrid-storage.md)과 맞지 않는다 |

## Consequences

- **긍정적**: Project note가 project의 home note 역할을 한다. 사용자는 Obsidian editor에서 quick memo를 직접 읽고 수정할 수 있다. Block reference 기반 link copy·task 변환·note 승격이 같은 식별자를 공유한다. 초기 UI와 repository 복잡도가 낮다.
- **부정적**: active project note가 길어질 수 있다. preview는 project note body를 다시 읽어야 하므로 매우 큰 note에서는 비용이 늘 수 있다.
- **리스크**: 여러 device에서 같은 project note를 동시에 수정하면 sync conflict 가능성이 있다. 완화 — append는 debounce하지 않고 즉시 flush하며, 같은 session의 rapid append는 project별 queue로 직렬화한다. stale write는 원본을 덮지 않고 conflicted copy를 생성한다. project note가 길어지는 패턴이 확인되면 월간/주간 log 파일 분리를 새 ADR로 검토한다.
- **검증**: `ProjectMemoService` 테스트(append, block id lookup, recent preview parsing, concurrent append, promote note). `ProjectRepository` 테스트(stale project body write가 conflicted copy를 남기는지). UI 테스트(memo append 후 preview refresh, metadata event refresh, task 변환, note 승격, link copy). `tests/manual/project-memo.md`로 두 device sync conflict와 external edit QA를 유지.

## References

- 관련 ADR: [ADR-0001](./0001-hybrid-storage.md)
- 관련 문서: PRD §7.10, §13.8, HLD §8.4, TASKS2 T2-102~T2-204
