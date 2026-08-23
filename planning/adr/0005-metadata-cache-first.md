# ADR-0005: 보드 스캔에 metadataCache 우선 사용

## Date

2026-05-10

## Context

플러그인 로드 시 `TaskMaster/Tasks/` 아래 모든 Markdown 파일을 스캔해 in-memory index를 만들어야 한다. 단순한 구현은 다음과 같다.

```ts
const files = app.vault.getMarkdownFiles().filter(...);
for (const file of files) {
  const content = await app.vault.read(file);
  const parsed = parseFrontmatter(content);
  ...
}
```

이 구현은 5000개 노트가 있는 Vault에서 5~15초가 걸린다. `vault.read()`는 매번 disk에서 파일을 읽기 때문이다. 사용자가 플러그인을 활성화한 직후 보드가 비어 있는 시간이 길어지면 인지 비용이 크다.

Obsidian은 `app.metadataCache`를 통해 frontmatter를 이미 캐싱하고 있다. 이 캐시를 활용하면 disk I/O 없이 frontmatter를 읽을 수 있다.

## Decision

**보드 렌더링에 필요한 frontmatter는 `app.metadataCache.getFileCache(file)?.frontmatter`를 우선 사용한다.**

read API 사용 분기:

| 상황 | API | 비고 |
| --- | --- | --- |
| 보드 렌더링용 frontmatter | `app.metadataCache.getFileCache(file)?.frontmatter` | Obsidian이 이미 캐싱, 거의 무료 |
| Detail panel의 본문 (lazy load) | `app.vault.cachedRead(file)` | 마지막으로 알려진 내용 |
| Conflict-sensitive write 직전 | `app.vault.read(file)` | mtime 비교 정확도 보장 위해 disk read |

본문은 보드 렌더링에 필요하지 않으므로 lazy load한다.

## Alternatives Considered

| 옵션 | 장점 | 단점 | 탈락 사유 |
| --- | --- | --- | --- |
| A. 모든 파일을 `vault.read()`로 스캔 | 명확하고 단순 | 큰 Vault에서 5~15초 소요 | 사용자 경험이 열악하다 |
| B. `vault.cachedRead()`로 통일 | read API 하나만 쓰면 됨. metadataCache가 아는 마지막 내용을 반환 | 본문 전체를 메모리에 올림 (5000개 × 평균 2KB = 10MB 상주) | 보드 렌더링에는 frontmatter만 필요한데 본문까지 로드하는 것은 낭비다 |
| C. 직접 캐시를 빌드해서 유지 | Obsidian API 변동에서 자유로움 | 이미 있는 캐시를 중복 구현 | metadataCache의 `changed` event를 구독하면 우리도 자동 업데이트된다 |

## Consequences

- **긍정적**: 5000개 노트 Vault에서 보드 초기 렌더링이 5초 → ~100ms로 단축된다. `metadataCache.on('changed', ...)`를 구독하면 외부 modify에도 빠르게 반응한다. 본문을 안 올리므로 메모리 사용량도 줄어든다.
- **부정적**: metadataCache는 Obsidian의 internal API에 가까워 향후 API 변경에 더 민감하다. 본문이 필요한 액션마다 별도 read 호출이 필요하다.
- **리스크**: API가 바뀌면 보드 스캔이 통째로 깨진다. 완화 — metadataCache는 Obsidian sample plugin과 다수 community plugin이 쓰는 잘 알려진 패턴이라 변경 risk가 낮고, 본문 lazy load는 detail panel·export 같은 명시적 액션에서만 발생해 영향이 미미하다. TaskRepository는 `findAll`(frontmatter only)과 `readBody(taskId)`를 분리해 호출자가 헷갈리지 않게 한다.
- **검증**: 1000개 task fixture로 초기 렌더링 시간 측정 → 1초 이내(PRD §10.2). metadataCache가 부재한(캐시 미빌드) 상황을 시뮬레이션해 graceful degradation 확인.

## References

- 관련 ADR: [ADR-0008](./0008-frontmatter-passthrough.md)
- 관련 문서: PRD §10.2, PLAN §3 Repository, §10
