# ADR-0008: Markdown serializer는 unknown frontmatter field를 passthrough

## Date

2026-05-10

## Context

Obsidian 사용자는 같은 노트에 우리 plugin이 모르는 frontmatter field를 추가할 수 있다.

```yaml
---
schemaVersion: 1
id: task_01HX...
type: task
status: doing
# 사용자가 직접 추가
tags: [project-alpha, urgent]
aliases: [website-renewal]
# Dataview 쿼리용
deadline: 2026-06-01
# 다른 plugin이 쓰는 field
templater_inserted: true
---
```

우리 serializer가 이 unknown field를 어떻게 다룰지가 plugin의 신뢰성에 직결된다. 후보는 모두 보존(passthrough), schema에 정의된 field만 보존, 보존하되 reserved name 충돌 시 경고 셋이다.

## Decision

**Unknown frontmatter field는 모두 보존한다 (passthrough).**

- TaskRepository는 read 시 frontmatter 전체를 구조에 보관.
- write 시 우리가 관리하는 field만 갱신하고 나머지는 원본 그대로 유지.
- field 순서도 가능한 한 보존 (gray-matter나 비슷한 라이브러리의 옵션 활용).

## Alternatives Considered

| 옵션 | 장점 | 단점 | 탈락 사유 |
| --- | --- | --- | --- |
| B. Schema 정의된 field만 보존 | 데이터 형태가 항상 예측 가능. round-trip 보장이 단순 | 사용자가 추가한 `tags`·`aliases`·Dataview field가 silently 사라짐 | 한 번 사라지면 사용자가 plugin을 신뢰하지 않게 된다. **Markdown source-of-truth라는 핵심 가치 위배** |
| C. 보존 + reserved 충돌 경고 | passthrough의 안전성 + reserved 보호 | 사용자가 의도적으로 쓰는 필드에 plugin이 참견하게 됨 | reserved 충돌은 사용자가 직접 frontmatter를 편집할 때만 발생하고, 그 경우 의도적이다. 우리 reserved name(`id`, `type`, `status`, `schemaVersion`, `createdAt`, `updatedAt`, `archivedAt`, `project`, `priority`, `date`, `participants`)은 우연한 충돌 가능성이 낮다 |

## Consequences

- **긍정적**: 사용자의 자유도가 최대한 보장된다. Dataview·Templater·Tag Wrangler 등 다른 plugin과 완전 호환된다. "plugin이 내 데이터를 건드린다"는 신뢰 손상 위험을 차단한다.
- **부정적**: write 시 매번 원본 frontmatter를 다시 읽고 merge해야 한다(부분 update가 아닌 full read-modify-write).
- **리스크**: 우리가 관리하는 field와 사용자 field 사이에 의미 충돌이 생길 수 있다(사용자가 `status`를 다른 의미로 쓰면 보드가 이상하게 동작). 완화 — read-modify-write 비용은 metadataCache로 frontmatter만 읽으므로 미미하고([ADR-0005](./0005-metadata-cache-first.md)), reserved name은 PRD §9.2·§9.3에 명시해 문서로 안내한다. mtime 비교 기반 conflict 감지와 결합하면 외부 변경을 우리가 덮어쓰는 일도 방지된다.
- **검증**: 사용자 정의 field를 포함한 task 파일을 read → write → read 했을 때 사용자 field가 그대로 남아 있는지 round-trip 단위 테스트. field 순서 보존 여부 단위 테스트. Dataview 쿼리가 우리 task 파일을 인식하는지 수동 QA.

## References

- 관련 ADR: [ADR-0005](./0005-metadata-cache-first.md)
- 관련 문서: PRD §9.2, §9.3, §10.4, §13.1, PLAN §4
