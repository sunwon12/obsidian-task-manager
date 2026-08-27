# Architecture Decision Records

이 디렉토리는 TaskMaster Obsidian 플러그인의 architectural decision record(ADR)를 보관합니다.

## ADR이란

ADR은 프로젝트의 중요한 기술적 결정을 시간 순서대로 기록한 짧은 문서입니다. 각 ADR은 다음을 답합니다.

- **무엇을 결정했는가** (Decision)
- **왜 그렇게 결정했는가** (Context)
- **무엇을 포기했는가** (Alternatives)
- **어떤 trade-off를 받아들였는가** (Consequences)

ADR은 미래의 코드 리뷰어와 신규 합류자가 "왜 이렇게 만들어졌지?"를 이해하는 데 사용됩니다.

## 작성 규칙

- 파일명: `{4자리 번호}-{kebab-case 제목}.md` (예: `0001-hybrid-storage.md`)
- 번호는 한 번 부여하면 재사용하지 않습니다. 코드 주석과 계획 문서가 `ADR-0008`처럼 번호로 참조하므로 번호와 파일명은 바꾸지 않습니다.
- 형식은 [`0000-template.md`](./0000-template.md)를 따릅니다. 이 템플릿은 상위 지식베이스의 `docs/adr/TEMPLATE.md`와 같은 형식이며, 번호 자릿수만 다릅니다.
- **`Status`·`Deciders`·`Reviewers`는 쓰지 않습니다.** 이 저장소는 개인 프로젝트라 작성자가 항상 같고, 적는 시점엔 이미 확정된 결정이라 상태를 따로 추적할 대상이 없습니다.
- 결정이 뒤집히면 새 ADR을 만들어 supersede하고, 이전 ADR의 `References`에 후속 ADR을 겁니다 (이력 보존).

## Index

| ID | 결정 |
| --- | --- |
| [0001](0001-hybrid-storage.md) | Markdown source-of-truth + JSON cache의 hybrid storage |
| [0002](0002-board-json-in-vault.md) | `.board.json`을 Vault 안에 두어 device 간 sync 지원 |
| [0003](0003-ulid-and-short-id-filename.md) | ULID 기반 ID와 short ID 파일명 |
| [0004](0004-immediate-flush-for-semantic-data.md) | 의미 데이터는 즉시 flush, 시각 데이터는 debounce |
| [0005](0005-metadata-cache-first.md) | 보드 스캔에 metadataCache 우선 사용 |
| [0006](0006-tailwind-style-isolation.md) | Tailwind v3 + `tm-` prefix + scoped CSS |
| [0007](0007-zustand-state-store.md) | Plugin core와 React UI를 잇는 state store로 Zustand 채택 |
| [0008](0008-frontmatter-passthrough.md) | Markdown serializer는 unknown frontmatter field를 passthrough |
| [0009](0009-mobile-no-dnd-phase1.md) | Phase 1 모바일은 dnd 미사용, 명시적 액션 버튼만 |
| [0010](0010-detail-ux-open-note-only.md) | Phase 1 카드 상세는 Obsidian note 열기만 |
| [0011](0011-project-quick-memo-storage.md) | Project quick memo는 project note append를 기본으로 한다 |
| [0012](0012-ai-draft-suggestions.md) | AI 초안은 JSON만 반환하고 적용은 TaskService를 탄다 |
| [0013](0013-human-ai-measurement-steps.md) | 단계는 인간·AI 시간을 구분하는 측정 국면으로 둔다 |
| [0014](0014-task-scoped-ai-proposals.md) | 태스크 AI는 읽기 전용 문맥과 확인형 변경안을 쓴다 |
