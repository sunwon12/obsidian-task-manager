# ADR-0010: Phase 1 카드 상세는 Obsidian note 열기만

## Date

2026-05-10

## Context

칸반 카드를 클릭했을 때 어떻게 상세 보기를 제공할지 결정이 필요하다. 후보는 (1) Obsidian editor에서 Markdown 노트 열기, (2) 보드 옆 인라인 quick view 패널 + 노트 열기 버튼, (3) Obsidian Modal API로 dialog 띄우기 셋이다.

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

| 옵션 | 장점 | 단점 | 탈락 사유 |
| --- | --- | --- | --- |
| B. 인라인 quick view 패널 | 보드를 떠나지 않고 메타데이터를 빠르게 수정 | layout split, panel state, markdown preview render component, 닫기·이동 단축키를 모두 만들어야 함 | 가치 대비 비용이 크다. **Phase 2**에서 검토 |
| C. Obsidian Modal | focus management를 Obsidian Modal API에 위임 | Modal 안에 React를 mount하는 패턴이 ItemView보다 까다롭고, ESC 닫기·외부 클릭 처리를 직접 해야 함 | 본문 편집은 결국 노트 열기로 위임할 거라면 모달의 가치가 작다 |

## Consequences

- **긍정적**: React UI가 매우 단순하다(카드 + 보드만). Obsidian-native 경험이라 editor의 모든 기능을 그대로 쓴다(vim mode, plugin extensions, command palette). 본문에서 wikilink·embed·code block을 풀 기능으로 편집한다.
- **부정적**: 보드를 떠나야 본문을 본다. 보드와 본문을 동시에 보려면 사용자가 Obsidian split view를 직접 열어야 한다. 메타데이터를 빠르게 수정하려면 frontmatter에 직접 접근해야 한다.
- **리스크**: 보드 ↔ 본문 왕복이 잦으면 마찰로 느껴질 수 있다. 완화 — split view는 사용자에게 익숙한 패턴이라 onboarding 부담이 작고, 가장 자주 바꾸는 메타데이터(status, priority)는 인라인 편집을 제공한다. 인라인 quick view 패널은 Phase 2에서 도입을 검토한다(PRD §16 오픈 이슈).
- **검증**: 카드 클릭 후 Obsidian editor가 ≤ 200ms 안에 열리는지 확인. 같은 카드를 두 번 클릭하면 새 탭이 중복 생성되지 않고 기존 탭이 reveal되는지 확인(`workspace.openLinkText`의 reveal 옵션). 본문 편집 후 보드로 돌아왔을 때 카드 summary가 갱신되는지 확인(Vault modify event 처리).

## References

- 관련 문서: PRD §7.2, §16, PLAN §13
