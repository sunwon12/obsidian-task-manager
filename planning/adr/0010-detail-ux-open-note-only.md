# ADR-0010: Phase 1 카드 상세는 Obsidian note 열기만

- **Status**: Accepted
- **Date**: 2026-05-10
- **Deciders**: 제품/엔지니어링
- **Related**: PRD §7.2, §16, PLAN §13

## Context

칸반 카드를 클릭했을 때 어떻게 상세 보기를 제공할지 결정이 필요하다. 후보:

1. 카드 클릭 = Obsidian editor에서 Markdown 노트 열기
2. 보드 옆에 quick view 패널을 인라인으로 띄우기 + 노트 열기 버튼
3. Obsidian Modal API로 dialog 띄우기

각 방식은 architectural 영향이 다르다.

- (1)은 React UI에 상세 컴포넌트가 거의 필요 없음. Obsidian editor가 책임을 모두 가져감.
- (2)는 React에 상세 패널 component, layout split, state 관리가 추가됨. 본문 일부를 markdown render도 해야 함.
- (3)은 Modal API + React component 통합이 필요. focus management 복잡.

Phase 1의 목표는 "아키텍처가 동작하는지 검증"이므로, UI 복잡도를 최소화하는 게 합리적이다.

## Decision

**Phase 1은 카드 클릭 시 Obsidian editor에서 해당 Markdown 노트를 연다. 별도 인라인 패널이나 모달은 만들지 않는다.**

- 카드의 inline 편집 가능 영역은 title, status (column 이동), priority (small dropdown) 정도로 한정.
- 본문, 결정 사항, action item, wikilink는 Obsidian editor에서 편집.
- 카드 ⋮ 메뉴 또는 우클릭에 "Open note", "Archive", "Delete" 액션 노출.
- 키보드: 카드 focus 시 `Enter`로 노트 열기.

```ts
async openTaskNote(taskId: string) {
  const path = pathById.get(taskId);
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    const leaf = app.workspace.getLeaf("tab"); // 새 탭에서 열기
    await leaf.openFile(file);
  }
}
```

## Alternatives Considered

### B. 인라인 quick view 패널

장점: 보드를 떠나지 않고 메타데이터 빠르게 수정.

거부 이유: Phase 1에서 layout split, panel state, markdown preview render component, 닫기/이동 단축키 등을 모두 만들어야 함. 가치 대비 비용 큼. **Phase 2**에서 검토.

### C. Obsidian Modal

장점: focus management를 Obsidian Modal API에 위임.

거부 이유: Modal 안에 React를 mount하는 패턴이 ItemView보다 까다로움. ESC로 닫기, 외부 클릭 처리 등을 plugin이 직접 처리해야 함. 본문 편집은 결국 노트 열기로 위임할 거라면 모달의 가치가 작음.

## Consequences

### Positive

- React UI가 매우 단순 (카드 + 보드만).
- Obsidian-native 경험 (editor의 모든 기능을 그대로 사용 가능: vim mode, plugin extensions, command palette).
- 본문에 wikilink, embed, code block 등을 풀 기능으로 편집.

### Negative

- 보드를 떠나야 본문을 봄. 보드와 본문을 동시에 보려면 Obsidian split view를 사용자가 직접 열어야 함.
- 메타데이터 빠르게 수정하려면 frontmatter에 직접 접근.

### Mitigation

- Obsidian의 split view는 사용자에게 익숙한 패턴이므로 onboarding 부담 작음.
- 카드에서 가장 자주 바꾸는 메타데이터(status, priority)는 인라인 편집 제공.
- Phase 2에서 인라인 quick view 패널 도입 검토 (PRD §16 오픈 이슈).

## Validation

- 카드 클릭 후 Obsidian editor가 ≤ 200ms 안에 열리는지 확인.
- 같은 카드를 두 번 클릭하면 새 탭이 중복 생성되지 않고 기존 탭이 reveal되는지 확인 (workspace.openLinkText의 reveal 옵션).
- 본문 편집 후 보드로 돌아왔을 때 카드 summary가 갱신되는지 확인 (Vault modify event 처리).
