# Dataview 호환 (passthrough) 수동 검증

T-708, ADR-0008. 자동 테스트는 `tests/integration/passthrough.test.ts`가 커버하며,
실제 Dataview plugin과의 통합은 수동으로 검증한다.

## 환경

- Obsidian 1.5+
- Dataview plugin 활성화

## Setup

1. Dataview plugin 설치 + 활성화.
2. TaskMaster plugin으로 task 1개 만들기.
3. 만들어진 task Markdown 파일을 Obsidian editor에서 열기.

## 1. 사용자 정의 field 추가

frontmatter를 다음으로 수정:

```yaml
---
schemaVersion: 1
id: task_...
type: task
status: doing
project: null
priority: high
createdAt: ...
updatedAt: ...
tags:
  - sample
  - urgent
deadline: 2026-06-01
estimatedHours: 4
---
```

저장하고 보드로 돌아와 카드를 다른 status로 이동.

## 2. 검증

- [ ] 카드 이동 후 Markdown 파일을 다시 열면 `tags`, `deadline`, `estimatedHours`가 모두 그대로 있음.
- [ ] field 순서도 우리가 작성한 그대로 (tags가 priority 다음에 위치).
- [ ] Dataview 쿼리가 우리 task를 인식:

  새 노트에 다음을 작성:

  ````
  ```dataview
  TABLE status, priority, deadline FROM "TaskMaster/Tasks"
  WHERE type = "task"
  ```
  ````

  - 카드의 status, priority, deadline이 표 형태로 나타나면 성공.

## 3. archive 후에도 보존

- [ ] 카드를 archive (Cmd+E).
- [ ] `TaskMaster/Archive/` 안의 파일을 열기 → 사용자 정의 field 모두 보존.
- [ ] frontmatter에 `archivedAt`만 추가됨.

## 4. 외부 plugin이 추가한 field

Tag Wrangler, Templater 등이 자동 추가하는 field도 같은 정책.

- [ ] Templater의 `templater_inserted: true` 같은 field가 사라지지 않음.

## 결과 기록

| 일자 | 검증자 | 통과 항목 | 실패 항목 |
| --- | --- | --- | --- |
| _YYYY-MM-DD_ | _name_ | _all_ | _none_ |
