# ADR-0008: Markdown serializer는 unknown frontmatter field를 passthrough

- **Status**: Accepted
- **Date**: 2026-05-10
- **Deciders**: 제품/엔지니어링
- **Related**: PRD §10.4, §13.1, PLAN §4

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

우리 serializer가 이 unknown field를 어떻게 다룰지가 plugin의 신뢰성에 직결된다.

후보:

1. 모든 unknown field 보존 (passthrough)
2. Schema에 정의된 field만 보존 (drop unknown)
3. 보존하되 우리 reserved name을 덮어쓰면 경고

## Decision

**Unknown frontmatter field는 모두 보존한다 (passthrough).**

- TaskRepository는 read 시 frontmatter 전체를 구조에 보관.
- write 시 우리가 관리하는 field만 갱신하고 나머지는 원본 그대로 유지.
- field 순서도 가능한 한 보존 (gray-matter나 비슷한 라이브러리의 옵션 활용).

## Alternatives Considered

### B. Schema 정의된 field만 보존

장점: 데이터 형태가 항상 예측 가능. round-trip 보장 단순.

거부 이유: 사용자가 추가한 `tags`, `aliases`, Dataview field가 silently 사라짐. 한 번 사라지면 사용자가 plugin을 신뢰하지 않게 되고, 결국 plugin을 안 쓰게 된다. **Markdown source-of-truth라는 핵심 가치 위배.**

### C. 보존 + reserved 충돌 경고

장점: passthrough의 안전성 + reserved 보호.

거부 이유: reserved 충돌은 사용자가 직접 frontmatter를 편집할 때만 발생하며, 그 경우 사용자는 의도적으로 그 필드를 쓰는 것. plugin이 경고를 띄울 자격이 없음. 우리 reserved name(`id`, `type`, `status`, `schemaVersion`, `createdAt`, `updatedAt`, `archivedAt`, `project`, `priority`, `date`, `participants`)은 충분히 일반적이지 않은 단어 조합이라 우연한 충돌 가능성은 낮음.

## Consequences

### Positive

- 사용자의 자유도 최대 보장.
- Dataview, Templater, Tag Wrangler 등 다른 plugin과 완전 호환.
- "plugin이 내 데이터를 건드린다"는 신뢰 손상 위험 차단.

### Negative

- write 시 매번 원본 frontmatter를 다시 읽고 merge해야 함 (부분 update가 아닌 full read-modify-write).
- 우리가 관리하는 field와 사용자 field 사이의 의미 충돌 가능 (예: 사용자가 우리 reserved name `status`를 다른 의미로 쓰면 보드가 이상하게 동작).

### Mitigation

- read-modify-write 비용은 metadataCache로 frontmatter만 읽으므로 미미 (ADR-0005).
- 우리 reserved name은 PRD §9.2, §9.3에 명시. 충돌 시 문서로 안내.
- conflict 감지(mtime 비교)와 결합하면 외부 변경을 우리가 덮어쓰는 일도 방지됨.

## Validation

- 사용자 정의 field를 포함한 task 파일을 read → write → read 했을 때 사용자 field가 그대로 남아 있는지 round-trip 단위 테스트.
- field 순서 보존 여부 단위 테스트.
- Dataview 쿼리가 우리 task 파일을 인식하는지 수동 QA.
