# TaskMaster Obsidian Plugin PRD

## 1. 문서 목적

이 문서는 TaskMaster Obsidian 플러그인의 제품 요구사항을 정의한다. 사용자가 어떤 문제를 해결해야 하는지, 초기 제품이 어떤 경험을 제공해야 하는지, 그리고 구현 완료 여부를 어떤 기준으로 판단할지 명확히 한다.

이 문서와 짝을 이루는 기술 명세는 `planning/PLAN-obsidian-task-manager.md`이다. PRD는 **무엇을, 왜** 만드는지 정의하고, PLAN은 **어떻게** 만드는지 정의한다. 데이터 스키마처럼 양쪽이 모두 다뤄야 하는 항목은 PRD가 "필드와 의미", PLAN이 "예시와 직렬화 형식"을 담당한다.

## 2. 제품 개요

TaskMaster는 React 기반의 프로젝트 및 칸반 관리 경험을 Obsidian 안에서 제공하는 로컬 우선 작업 관리 플러그인이다. 사용자는 Obsidian Vault 안에서 task, meeting, project 정보를 Markdown 파일로 소유하고, 플러그인은 이를 칸반 보드와 회의 기반 작업 흐름으로 시각화한다.

핵심 제품 방향은 다음과 같다.

- 모든 의미 있는 데이터는 사용자의 로컬 Vault 안에 저장한다.
- Task와 Meeting은 Obsidian 노트로 직접 열고 수정할 수 있어야 한다.
- React 기반 UI는 빠르고 익숙한 칸반 작업 경험을 제공한다.
- Obsidian의 `[[wikilink]]`, backlink, Markdown 편집 경험과 자연스럽게 이어진다.
- JSON 파일은 빠른 렌더링과 보드 상태 복구를 위한 캐시로만 사용한다.

## 3. 문제 정의

Obsidian 사용자는 프로젝트 기록, 회의록, 결정 사항, 참고 문서를 Vault에 잘 축적할 수 있지만, 실행해야 할 작업을 칸반처럼 빠르게 관리하려면 별도 앱을 쓰는 경우가 많다. 이때 다음 문제가 생긴다.

- 프로젝트 지식과 작업 상태가 서로 다른 도구에 흩어진다.
- 회의록에서 나온 action item을 실제 task로 추적하기 어렵다.
- 외부 SaaS 기반 작업 관리 도구는 로컬 우선 지식 관리 흐름과 맞지 않는다.
- 작업 카드의 빠른 조작성과 Markdown 노트의 장기 보관성을 동시에 만족하기 어렵다.

TaskMaster는 Obsidian Vault를 단일 작업 공간으로 유지하면서, 칸반 UI의 조작성과 Markdown 기반 지식 관리의 장점을 함께 제공한다.

## 4. 대상 사용자

### 4.1 Primary User

Obsidian을 개인 또는 소규모 팀의 지식 베이스로 사용하면서, 프로젝트 task와 회의 action item을 Vault 안에서 관리하고 싶은 사용자.

대표 특성:

- 로컬 파일 소유권과 장기 보관성을 중요하게 생각한다.
- Markdown, wikilink, frontmatter 사용에 익숙하거나 수용 가능하다.
- 프로젝트별 작업 상태를 칸반 보드로 보고 싶다.
- 회의록과 task 사이의 연결을 유지하고 싶다.

### 4.2 Secondary User

기존 React 기반 TaskMaster UI를 Obsidian 플러그인 형태로 재사용하거나 확장하려는 개발자 및 파워 유저.

대표 특성:

- 플러그인 데이터 구조를 직접 이해하고 관리할 수 있다.
- Git Sync, Obsidian Sync, Dataview 등 다른 플러그인과 함께 쓰기를 원한다.
- 향후 LLM 기반 action item 추출이나 자동 task draft 기능을 기대한다.

## 5. 제품 목표

1. Obsidian 안에서 TaskMaster 전용 View를 열고 작업 보드를 사용할 수 있다.
2. Task, Meeting, Project의 원본 데이터는 Markdown 파일로 저장된다.
3. 사용자가 Markdown 파일을 직접 수정해도 TaskMaster UI가 변경을 반영한다.
4. 칸반 카드 이동, 상태 변경, 순서 변경은 안정적으로 저장되고 Obsidian 재시작 후 복구된다.
5. React UI가 Obsidian Vault API에 직접 의존하지 않는 구조를 유지한다.
6. Obsidian 전역 스타일과 충돌하지 않는 독립적인 UI 스타일을 제공한다.
7. 키보드만으로도 카드 생성/이동/상태 변경이 가능하다.

## 6. 비목표

초기 버전에서는 다음을 제공하지 않는다.

- 실시간 다중 사용자 협업
- 플러그인 자체 클라우드 동기화
- 완전 자동화된 LLM 워크플로
- 수천 개 이상 task를 위한 대규모 virtualization
- 복잡한 conflict resolution 전용 UI
- 별도 서버, 데이터베이스, 계정 시스템
- 다국어 지원 (Phase 1은 한국어와 영어 두 locale 정도만 수동 string 관리)

## 7. 핵심 사용자 시나리오

### 7.1 TaskMaster View 열기

사용자는 Obsidian ribbon icon 또는 command palette에서 TaskMaster를 실행한다. 플러그인은 TaskMaster 전용 View를 열고, 기존 Vault 데이터를 스캔한 뒤 칸반 보드를 렌더링한다.

수용 기준:

- Command palette에서 TaskMaster View를 열 수 있다.
- Ribbon icon으로 동일한 View를 열 수 있다.
- 이미 열린 View가 있으면 새 View를 중복 생성하지 않고 기존 View를 reveal한다.
- 같은 사용자가 명시적으로 두 번째 View를 띄우는 경우 (workspace split), 두 View는 동일 in-memory store와 event bus를 공유한다.
- View를 닫으면 React root와 이벤트 구독이 정리된다.

### 7.2 Task 생성

사용자는 칸반 보드에서 새 task를 만든다. 플러그인은 `TaskMaster/Tasks/` 아래에 frontmatter가 포함된 Markdown 파일을 생성하고, UI에 즉시 task card를 표시한다.

수용 기준:

- 새 task는 안정적인 `id`를 가진다.
- 새 task는 `schemaVersion`, `type: task`, `status`, `createdAt`, `updatedAt` frontmatter를 가진다.
- 파일 경로는 `TaskMaster/Tasks/{safe-title} - {short-id}.md` 형식을 따른다 (자세한 규칙은 PLAN 5장 참조).
- Markdown heading은 task title과 동기화된다.
- 생성된 파일은 Obsidian에서 일반 Markdown 노트로 열 수 있다.

### 7.3 Task 상태 변경과 Drag and Drop

사용자는 task card를 칸반 column 사이로 이동하거나 같은 column 안에서 재정렬한다.

수용 기준:

- column 이동 시 task의 `status`가 Markdown frontmatter에 **즉시 flush**된다 (debounce 적용 안 함, onunload 손실 방지).
- 같은 column 안의 시각적 순서는 `.board.json`에만 저장되며, frontmatter에는 순서 정보를 두지 않는다.
- 같은 column 안 reorder만 debounce 처리된다 (기본 500ms, 10.2 참조). 의미 데이터가 아닌 시각 데이터이므로 손실되어도 9.4 알고리즘으로 회복 가능하다.
- Obsidian을 재시작해도 column 상태와 카드 순서가 복구된다.
- `.board.json`이 없거나 손상되어도 Markdown frontmatter (`status`, `updatedAt`)와 파일명을 기준으로 보드를 결정적으로 재구성할 수 있다.

### 7.4 Markdown 직접 수정 반영

사용자는 Obsidian editor에서 task Markdown 파일의 frontmatter나 본문을 직접 수정한다. TaskMaster는 Vault 변경 이벤트를 감지하고 UI를 갱신한다.

수용 기준:

- `TaskMaster/` 아래 Markdown 파일의 `create`, `modify`, `delete`, `rename` 이벤트를 처리한다.
- 변경된 파일 하나만 재파싱할 수 있으면 전체 스캔 없이 해당 entity만 갱신한다.
- 파일명이 바뀌어도 frontmatter `id`가 같으면 동일 task로 인식한다.
- 삭제된 task는 UI에서 제거된다.
- 파싱할 수 없는 파일은 전체 플러그인을 깨뜨리지 않고 무시하며, 실패 사실을 in-memory diagnostics와 non-blocking notice로 안내한다 (8.7 참조).

### 7.5 Task 삭제

사용자는 보드 카드의 컨텍스트 메뉴 또는 키보드 shortcut으로 task를 삭제한다.

수용 기준:

- "Delete" 액션은 Obsidian의 시스템 휴지통(`app.vault.trash`)을 사용해 Markdown 파일을 삭제한다.
- 삭제 직전 confirm dialog로 사용자 확인을 받는다 (간단한 modal로 충분).
- 삭제된 task의 entry는 모든 column과 `board.json`에서 즉시 제거된다.
- 외부에서 파일이 삭제되어도 동일 흐름으로 UI가 갱신된다.
- "Archive로 보내기"와는 별개의 액션이다 (7.6 참조).

### 7.6 Task Archive

활성 보드에서 제외하지만 데이터는 보관하고 싶은 task는 archive로 이동한다.

수용 기준:

- "Archive" 액션은 파일을 `TaskMaster/Archive/` 아래로 move한다.
- archive된 task는 frontmatter에 `archivedAt` 필드를 가진다.
- archive된 task는 활성 보드에 표시되지 않으며, `board.json`에서 제거된다.
- archive 폴더에 있던 파일을 활성 폴더로 다시 옮기면 (manual restore) 다음 sync 시 보드에 다시 나타난다.
- 별도 archive view는 Phase 1 범위에서 제외하지만, 사용자는 Obsidian file explorer로 archive를 탐색할 수 있다.

### 7.7 Meeting Note 생성과 Action Item 연결

사용자는 회의 노트를 만들고, 회의에서 나온 action item을 task와 연결한다.

수용 기준:

- meeting note는 `TaskMaster/Meetings/` 아래 Markdown 파일로 저장된다.
- meeting note는 `schemaVersion`, `id`, `type: meeting`, `project`, `date`, `participants`, `createdAt`, `updatedAt` frontmatter를 가진다.
- meeting 본문에는 논의 내용과 action item 섹션을 작성할 수 있다.
- action item은 task로 승격하거나 기존 task와 연결할 수 있는 구조를 가진다 (Phase 1은 명시적 wikilink, Phase 2에서 자동화).
- 관련 노트는 Obsidian `[[wikilink]]`로 연결할 수 있다.

### 7.8 Conflict 감지

사용자가 UI에서 저장하려는 사이에 동일 Markdown 파일이 외부에서 변경될 수 있다. 플러그인은 조용히 덮어쓰지 않고 충돌을 감지해야 한다.

수용 기준:

- 저장 직전 마지막으로 알고 있던 modified time과 현재 modified time을 비교한다.
- 외부 변경이 감지되면 최신 파일을 다시 읽는다.
- frontmatter-only 변경은 가능한 경우 field 단위 merge를 시도한다.
- 안전하게 merge할 수 없으면 conflicted copy를 만들고 non-blocking notice를 보여준다.
- conflict 발생은 event bus를 통해 UI에 전달되어 카드에 warning state를 표시할 수 있다.

### 7.9 키보드 기반 보드 조작 (a11y)

dnd 만으로는 키보드 사용자나 screen reader 사용자가 보드를 운용할 수 없다. 모든 핵심 액션에 키보드 대안을 제공한다.

수용 기준:

- Tab/Shift-Tab으로 카드를 순차 focus 할 수 있다.
- 포커스된 카드에서 다음 키를 처리한다.
  - `Enter`: 상세 패널 열기 또는 노트 열기
  - `Cmd/Ctrl + Enter`: 다음 status로 이동
  - `Cmd/Ctrl + Shift + Enter`: 이전 status로 이동
  - `Cmd/Ctrl + ↑/↓`: 같은 column 안에서 순서 이동
- 카드와 column에 적절한 ARIA role과 label을 부여한다 (`role="listitem"`, `aria-label`로 카드 title과 status 노출).
- focus ring은 Obsidian theme color를 따른다.

### 7.10 Project Quick Memo (Phase 2)

사용자는 특정 project를 진행하면서 떠오른 짧은 메모, 결정 전 생각, 참고 링크, 후속 질문을 별도 제목 짓기 없이 빠르게 남기고 싶다. 이 메모는 task처럼 실행 항목일 수도 있고, 나중에 회의록이나 독립 노트로 승격될 수도 있다.

제품 방향:

- 빠른 메모의 기본 저장 방식은 **메모마다 별도 페이지 생성이 아니라 project note 안의 append-only 블럭**이다.
- 메모가 길어지거나 독립적으로 링크될 가치가 생기면 사용자가 명시적으로 별도 note로 승격한다.
- 한 project note가 지나치게 길어지는 경우를 대비해 Phase 2 후반에는 월간/주간 project log 파일 분리를 검토한다. 단, 첫 구현은 project note append를 기본으로 한다.
- quick memo는 Obsidian Markdown으로 저장되어야 하며, 사용자는 Obsidian editor에서 자유롭게 수정할 수 있어야 한다.

수용 기준:

- project filter가 특정 project로 설정된 상태에서 보드 상단에 quick memo 입력 블럭이 표시된다.
- 사용자는 한 줄 또는 여러 줄 memo를 입력하고 `Cmd/Ctrl + Enter` 또는 저장 버튼으로 즉시 append할 수 있다.
- append 대상은 해당 project Markdown note의 `## Quick Notes` 섹션이다. 섹션이 없으면 자동 생성한다.
- 같은 날짜의 memo는 `### YYYY-MM-DD` 하위에 시간순으로 추가한다.
- 각 memo는 향후 task 변환이나 링크 복사를 위해 Obsidian block reference 형식의 안정 id를 가진다.
- block id 형식은 `^tm-memo-<ULID>`이며 memo bullet 첫 줄 끝에 붙인다. 예: `- 09:30 memo text ^tm-memo-01HX...`
- 입력 후 memo draft는 비워지고, project memo preview가 최신 내용으로 갱신된다.
- quick memo 저장 실패, conflict, parse 실패는 Diagnostics와 non-blocking Notice로 안내한다.
- 사용자는 project header의 "Open memo" 액션으로 project note를 바로 열 수 있다.
- 사용자는 개별 memo를 task로 변환하거나 별도 note로 승격할 수 있다. 이 기능은 quick memo append 이후의 Phase 2 후속 task로 구현 가능하다.

권장 project note 기본 템플릿:

```md
# {project title}

## Goal

## Current Status

## Decisions

## References

## Quick Notes
```

### 7.11 Removed: Timeline / WBS View

2026-05-11 사용성 점검 결과, Timeline 형식은 TaskMaster의 현재 작업 흐름과 맞지 않아 제거한다.

결정:

- Board / Archive / Project memo 흐름을 유지한다.
- Timeline view, task scheduling managed field, Timeline 전용 UI state는 제품 범위에서 제거한다.
- 기존 Markdown에 남아 있는 `startDate`, `dueDate`, `milestone` field는 unknown frontmatter passthrough로 보존한다.
- 향후 planning UX가 필요하면 날짜 축이 아니라 project memo 또는 lightweight outline/checklist 방식으로 다시 검토한다.

## 8. 기능 요구사항

### 8.1 Obsidian 플러그인 호스트

- 플러그인은 Obsidian이 요구하는 `manifest.json`, `main.js`, `styles.css` 산출물을 제공해야 한다.
- 플러그인 로드 시 TaskMaster View를 등록해야 한다.
- 플러그인 언로드 시 pending write를 flush하고 View와 이벤트 구독을 정리해야 한다.

### 8.2 React View

- React 18 기반 UI를 Obsidian `ItemView` 안에 mount한다.
- Kanban board는 HOLD, TODO, DOING, IN REVIEW, DONE 기본 column을 제공한다.
- Kanban board 바로 위에는 rounded status visibility chip을 제공하며, 꺼진 status column은 placeholder 없이 view에서만 숨긴다.
- status visibility toggle은 task frontmatter `status`나 `.board.json` ordering을 변경하지 않는다.
- UI는 Obsidian 테마 안에서 깨지지 않아야 한다.
- Desktop에서는 가로 column board와 마우스 dnd를 제공한다.
- Tablet에서는 가로 scroll 가능한 column layout과 dnd를 제공한다.
- Mobile에서는 status tab 또는 segmented control 기반의 단일 column grouped list를 제공하며, dnd 대신 "다음 status로 이동" 액션 버튼을 카드에 노출한다.

### 8.3 데이터 저장

- Markdown은 task, meeting, project, decision, action item, 긴 설명, wikilink의 source of truth다.
- JSON은 cache, board ordering, 마지막으로 연 project, denormalized summary, UI 상태 저장에만 사용한다.
- `data.json`은 삭제되거나 손상되어도 Markdown 스캔으로 재생성 가능해야 한다.
- 파일 경로는 identity가 아니며, 모든 영속 entity는 frontmatter `id`를 기준으로 식별한다.
- 모든 frontmatter는 `schemaVersion` 필드를 가진다.

### 8.4 Repository와 Service 경계

- React component는 가능한 한 Service를 통해 작업을 수행한다.
- Obsidian Vault API 접근은 Repository 계층에 격리한다.
- Service는 task 생성, 상태 변경, 보드 재정렬, archive, meeting 생성, action item 연결, index rebuild 같은 비즈니스 흐름을 담당한다.
- Repository는 Markdown read/write, frontmatter parsing, JSON cache 관리, debounce/batch write, Vault event 구독을 담당한다.

### 8.5 Event Bus

- Plugin core와 React UI는 typed event bus로 연결한다.
- 최소 이벤트는 `tasks:indexed`, `task:created`, `task:updated`, `task:deleted`, `task:archived`, `board:updated`, `vault:conflict`, `parser:error`를 포함한다.
- UI는 Vault 변경이나 cache rebuild 결과를 event bus를 통해 반영할 수 있어야 한다.

### 8.6 Style Isolation

- Tailwind class는 `tm-` prefix를 사용한다.
- Tailwind preflight는 비활성화한다.
- CSS는 `.taskmaster-root` 하위로 scope를 제한한다.
- Obsidian 전역 UI나 다른 플러그인 스타일을 오염시키지 않아야 한다.

### 8.7 Diagnostics와 로깅

- 파싱 실패, conflict, flush 실패는 in-memory `DiagnosticsLog`에 timestamp, 파일 경로, 사유와 함께 기록된다.
- Phase 1은 settings 화면 하단의 "Diagnostics" 섹션에서 최근 50개 항목을 보여준다.
- console에는 `[TaskMaster]` prefix를 붙여 로그를 출력한다.
- 사용자에게 직접 영향을 주는 실패는 Obsidian Notice로도 안내한다 (실패 종류별 throttle).

### 8.8 i18n

- Phase 1은 한국어와 영어 두 locale을 지원한다.
- UI 문자열은 `src/i18n/{locale}.ts`에 모은다 (별도 라이브러리 없이 단순 lookup map).
- Locale 결정은 Obsidian의 `moment.locale()`을 우선 따르고, 인식할 수 없으면 영어로 fallback한다.
- 사용자 데이터(task title, meeting note 본문)는 i18n 대상이 아니다.

### 8.9 설정 화면

설정 화면은 사용자 Vault에 직접 영향을 주는 동작을 노출하기 위해 Phase 1부터 제공한다.

Phase 1 설정 항목:

- **데이터 루트 경로** (기본값 `TaskMaster/`, 읽기 전용으로 표시)
- **저장 debounce 시간** (기본 500ms, 100~2000ms 범위)
- **삭제 시 confirm 표시** (기본 on)
- **Diagnostics 보기**

설정값은 `.obsidian/plugins/taskmaster-plugin/settings.json`에 저장된다. 파일이 없거나 손상되면 기본값으로 복구한다.

## 9. 데이터 모델 요구사항

### 9.1 Vault 경로

```txt
[Vault]/TaskMaster/
  Tasks/
  Meetings/
  Projects/
  Archive/
  .board.json

[Vault]/.obsidian/plugins/taskmaster-plugin/
  data.json
  settings.json
```

`.board.json`은 의도적으로 Vault 안에 둔다. `.obsidian/plugins/` 폴더는 Obsidian Sync, Git 등 대부분의 sync 도구가 기본 제외하므로, 카드 시각 순서를 device 간에 공유하려면 Vault 안에 있어야 한다. dotfile 형태(`.board.json`)로 두어 file explorer에서 노이즈가 되지 않도록 한다.

`data.json`과 `settings.json`은 device-local 캐시/설정이므로 plugin 폴더에 둔다.

### 9.2 Task 필수 필드

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| `schemaVersion` | integer | 현재 1 |
| `id` | string | `task_<ULID>` 형식 |
| `type` | enum | `task` 고정 |
| `status` | enum | `hold` \| `todo` \| `doing` \| `in-review` \| `done` |
| `project` | string \| null | project ID (`project_<ULID>`) 또는 null |
| `priority` | enum \| null | `low` \| `medium` \| `high` \| null |
| `createdAt` | ISO datetime | 생성 시각 |
| `updatedAt` | ISO datetime | 마지막 수정 시각 |
| `archivedAt` | ISO datetime \| null | archive된 경우 시각, 그렇지 않으면 부재 또는 null |

시각적 순서는 frontmatter에 두지 않는다 (9.4 참조).

### 9.3 Meeting 필수 필드

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| `schemaVersion` | integer | 현재 1 |
| `id` | string | `meeting_<ULID>` 형식 |
| `type` | enum | `meeting` 고정 |
| `project` | string \| null | project ID 또는 null |
| `date` | YYYY-MM-DD | 회의 일자 |
| `participants` | string[] | 참석자 이름 배열 |
| `createdAt` | ISO datetime | 생성 시각 |
| `updatedAt` | ISO datetime | 마지막 수정 시각 |

### 9.4 Board Cache (`.board.json`)

`.board.json`은 시각적 순서의 단일 source of truth이며, 다음 정보를 저장한다.

- board schema version (`version: 1`)
- column id, title, taskId 순서
- `updatedAt` (마지막 변경 시각, sync conflict 해소에 사용)

#### 손상 또는 부재 시 재구성

다음 결정적 알고리즘으로 재구성한다.

1. Markdown frontmatter의 `status`로 column을 결정한다.
2. 같은 column 안에서는 `updatedAt` 내림차순 (최근 수정이 위)으로 정렬한다.
3. `updatedAt`이 동일하면 파일명 사전순으로 정렬한다.
4. 결과를 새로운 `.board.json`으로 저장한다.

이 알고리즘은 사용자가 직접 정한 카드 순서를 잃지만, 의미적 정보(`status`)는 Markdown에서 그대로 유지된다.

#### Sync Conflict 해소

`.board.json`은 Vault 안에 있으므로 device 간 sync 충돌 가능성이 있다. 두 device가 같은 파일을 다른 순서로 저장한 경우:

1. 더 큰 `updatedAt`을 가진 쪽을 winner로 채택한다.
2. winner와 loser의 `taskIds`를 비교해, **winner에 없지만 loser에 있는 taskId**(상대 device에서만 알고 있는 새 task)는 해당 column 끝에 append한다.
3. 어느 쪽에도 없는 taskId(외부 새 파일)는 9.4 재구성 알고리즘으로 보충한다.

이 정책은 "최근 device의 순서를 우선하되, 다른 device의 새 task를 잃지 않는다"를 보장한다.

### 9.5 ID 형식

ID는 ULID (Crockford Base32 26자) 기반이며, prefix를 붙여 entity 종류를 표현한다.

```txt
task_01HX7SM2J6K4XQ7EV6C8T92PPW
meeting_01HX7T4A0KN9F9RHHKMJ4F5H8A
project_01HX9C5K3D8GHX0Y7T2QN8VFE2
```

파일명에 노출되는 short ID는 ULID 앞 8자만 사용한다 (예: `01HX7SM2`). short ID 충돌이 발생하면 자동으로 9, 10, ... 자로 확장한다. 파일명은 사람이 읽기 위한 보조이며, 실제 entity 매칭은 항상 frontmatter `id` 풀 형식 기준이다.

## 10. 비기능 요구사항

### 10.1 신뢰성

- Markdown 파일 하나의 파싱 실패가 전체 보드 렌더링 실패로 이어지면 안 된다.
- cache 파일 손상은 자동 rebuild로 복구해야 한다.
- 저장 중 충돌 가능성을 감지해야 한다.
- flush 실패는 retry queue에 등록되고, 일정 횟수 실패 시 사용자에게 안내한다 (PLAN 10장 참조).

### 10.2 성능

다음 정량 기준을 만족한다.

- 보드 초기 렌더링: 1000개 이하 task 기준 1초 이내 (M1급 일반 노트북, desktop Obsidian).
- 초기 스캔은 `app.metadataCache`를 우선 사용한다. 본문이 필요할 때만 `vault.cachedRead()`를 호출하며, 가능한 한 `vault.read()` 직접 호출은 피한다 (PLAN 10장 참조).
- card drag interaction: 60fps 기준 frame drop이 사용자에게 인지될 정도로 발생하지 않아야 한다.
- Markdown write: status 변경은 즉시 flush. 같은 column 안 reorder는 debounce 500ms로 묶어 task당 Vault write 호출 1회 이하.
- 단일 파일 외부 modify: 250ms 이내에 UI 반영.
- 전체 rebuild는 시작 시 또는 cache 손상 시에만 수행한다.

### 10.3 보안과 개인정보

- 초기 버전은 외부 서버로 데이터를 전송하지 않는다.
- 모든 task, meeting, settings, cache 데이터는 Vault 내부에 저장한다.
- LLM 기능은 Phase 4에서 도입하며, 첫 호출 전 명시적 동의 화면(provider, 전송 범위, opt-out 방법)을 거친다 (14.4 참조).

### 10.4 유지보수성

- React UI는 Obsidian API에 직접 결합되지 않아야 한다.
- parser, repository, service, UI 계층을 분리한다.
- JSON cache는 schema version을 가져야 한다.
- Markdown serializer는 frontmatter와 본문을 안정적으로 보존해야 한다 (round-trip 테스트로 검증).

### 10.5 호환성

- Obsidian desktop을 우선 지원한다 (`minAppVersion: 1.5.0` 가정).
- Obsidian mobile은 Phase 1에서 dnd를 지원하지 않으나 보기/이동 액션은 지원한다.
- Obsidian Sync, Git Sync, iCloud, Dropbox 등 외부 파일 변경 가능성을 전제로 설계한다.

### 10.6 접근성 (a11y)

- 모든 interactive element는 키보드로 도달 가능해야 한다.
- 모든 카드와 column은 적절한 ARIA role과 label을 가진다.
- status visibility chip은 pressed state를 전달하고, mobile status tab과 구분되는 accessible label을 가진다.
- focus ring은 시각적으로 분명하게 제공한다.
- 색상만으로 상태를 표현하지 않는다 (status는 column 위치 + 텍스트로 함께 표현).

### 10.7 테스트와 검증

- 단위 테스트 프레임워크는 Vitest를 사용한다.
- 다음 영역은 단위 테스트 필수: frontmatter parser/serializer, board cache rebuild, board ordering reconcile, conflict detection, settings fallback, ID 생성과 short ID 충돌 처리.
- Vault event 처리와 React lifecycle은 수동 QA checklist로 검증한다 (Milestone 1 시점에 checklist 문서화).
- Phase 1은 e2e 자동화(Playwright 등) 범위에서 제외한다.

## 11. 초기 릴리스 범위

초기 릴리스는 제품의 핵심 가정 검증에 집중한다.

포함 범위:

- TaskMaster View 열기 (ribbon, command palette)
- Todo, Doing, Done 기본 칸반 보드 표시
- Markdown 파일 기반 task 생성/수정/삭제
- Task archive
- task card column 이동 (마우스 dnd + 키보드)
- task status를 Markdown frontmatter에 저장
- visual order를 `board.json`에 저장
- Obsidian reload 후 board 복구
- task Markdown frontmatter 직접 수정 시 UI 갱신
- 기본 conflict detection
- scoped Tailwind 스타일
- 최소 설정 화면
- 한국어/영어 i18n
- 기본 a11y (키보드, ARIA)
- 완료 task 숨기기 토글, project filter

제외 범위:

- LLM action item 자동 추출
- 복잡한 project dashboard
- 본문/title 검색, priority filter
- 대규모 virtualization
- mobile dnd
- 고급 conflict merge UI
- 별도 archive view

## 12. 성공 지표

### 12.1 기능 성공 지표

- 사용자가 Obsidian 안에서 TaskMaster View를 열고 task를 생성할 수 있다.
- 생성된 task가 Markdown 파일로 Vault 안에 남는다.
- task를 column 사이로 이동하면 Markdown `status`가 갱신된다.
- column 내부 순서가 `board.json`으로 유지된다.
- Obsidian 재시작 후에도 보드가 동일하게 복구된다.
- Markdown frontmatter를 직접 수정하면 UI가 갱신된다.
- 키보드만으로 카드 생성, 상태 변경, 순서 이동이 가능하다.
- archive된 task는 보드에서 사라지고 `TaskMaster/Archive/`에서 발견된다.

### 12.2 정량 품질 지표

- 1000개 task 기준 보드 초기 렌더링 1초 이내.
- 같은 task 연속 drag 시 Vault write 호출이 task당 초당 2회 이하.
- 단일 파일 외부 modify 후 UI 반영 250ms 이내.
- View를 50회 open/close 반복해도 React root나 event subscription leak이 없어야 한다 (devtools snapshot 기준 동일).
- cache 파일을 삭제 후 reload하면 30초 이내 보드가 재구성된다.

## 13. 주요 리스크와 대응

### 13.1 Markdown과 JSON Drift

리스크: Markdown 원본과 JSON cache가 서로 다른 상태가 될 수 있다.

대응: Markdown이 의미적 데이터의 source of truth, `board.json`이 시각적 순서의 source of truth로 책임을 분리한다. JSON은 언제든 9.4 알고리즘으로 재생성 가능하게 설계한다.

### 13.2 과도한 Vault Write

리스크: drag, inline editing, reorder가 많은 disk write를 만들 수 있다.

대응: write debounce(500ms), 같은 entity 연속 변경 병합, `board.json` 기반 visual ordering으로 Markdown write를 status 변경에만 한정한다.

### 13.3 외부 파일 변경

리스크: Obsidian editor나 sync tool이 만든 변경을 플러그인이 덮어쓸 수 있다.

대응: modified time을 추적하고 저장 전 conflict를 감지한다.

### 13.4 CSS 충돌

리스크: Tailwind 또는 app style이 Obsidian 전역 UI에 영향을 줄 수 있다.

대응: `tm-` prefix, `preflight: false`, `.taskmaster-root` scoped CSS를 사용한다.

### 13.5 React와 Obsidian Lifecycle Leak

리스크: View를 닫은 뒤에도 React root나 event subscription이 남을 수 있다. 또한 Obsidian의 `onunload`는 async return을 기다리지 않으므로, pending Vault write가 flush 전에 사라질 수 있다.

대응:

- `onClose`에서 React를 unmount하고 event subscription을 dispose한다.
- **의미적 변경(status, title, archive, delete)은 debounce 없이 즉시 flush**해 onunload 손실 위험을 원천 차단한다.
- 손실되어도 회복 가능한 시각 데이터(`.board.json` reorder)만 debounce한다.
- `onunload`는 fire-and-forget으로 `flush()`를 호출하되, 그 결과에 의존하지 않는다.

### 13.6 Mobile dnd 한계

리스크: 모바일 환경에서 dnd-kit의 touch sensor가 scroll과 충돌하거나 long-press 지연으로 사용성을 떨어뜨린다.

대응: Phase 1 모바일은 dnd를 제공하지 않고 명시적 액션 버튼으로 대체한다.

### 13.7 LLM Phase 4의 Privacy 회귀

리스크: LLM 기능 도입 시 외부 서버 전송 가능성이 생기며, 10.3의 "외부 서버 전송 없음" 가정이 깨진다.

대응: Phase 4 첫 LLM 호출 전 명시적 동의 화면을 표시하고, 사용자가 동의하지 않으면 모든 LLM 기능을 비활성화한다. local provider(Ollama, LM Studio)는 동의 없이 사용 가능하다.

### 13.8 Project Quick Memo의 파일 성장과 충돌

리스크: project note 하나에 quick memo를 계속 append하면 파일이 길어지고, 여러 device에서 같은 project memo를 동시에 추가할 때 sync conflict 가능성이 커진다.

대응:

- Phase 2의 기본값은 project note append로 유지하되, append 위치를 `## Quick Notes` / `### YYYY-MM-DD`로 제한해 사람이 직접 정리하기 쉽게 한다.
- quick memo 저장은 의미 데이터이므로 debounce하지 않고 즉시 flush한다.
- 각 quick memo는 `^tm-memo-<ULID>` Obsidian block reference를 가져 conflict 이후에도 원본 memo를 식별하고 링크할 수 있게 한다.
- conflict가 감지되면 기존 Markdown conflict 정책을 따르고, 사용자가 잃어버린 memo를 찾을 수 있도록 conflicted copy와 Diagnostics를 남긴다.
- project note가 길어지는 사용 패턴이 확인되면 월간/주간 project log 파일(`TaskMaster/ProjectMemos/{project-id}/YYYY-MM.md`)로 자동 분리하는 옵션을 검토한다.

## 14. 단계별 로드맵

### 14.1 Phase 1. Architecture Validation

- Obsidian plugin scaffold (esbuild)
- React 18 `ItemView` mount
- Tailwind v3 prefix와 scoped CSS
- task/meeting/project Markdown schema (`schemaVersion: 1`)
- task repository/service
- startup scan과 index rebuild
- `board.json` ordering cache
- Vault file change subscription
- 기본 conflict detection
- 기본 Kanban UI + 키보드 조작
- task 삭제와 archive
- 최소 설정 화면
- 한국어/영어 i18n
- diagnostics 화면
- Vitest 단위 테스트

### 14.2 Phase 2. Markdown Native Task Management

상세 실행 계획은 `planning/TASKS2.md`에서 추적한다.

- Phase 1 사용성 하드닝: filtered reorder 보존, Diagnostics store 연결, settings live update 또는 reload 안내, desktop card menu, 키보드 reorder
- project note를 "프로젝트 홈"으로 활성화: Open memo 액션, 기본 템플릿, memo preview
- Project Quick Memo: project note의 `## Quick Notes` 섹션에 빠른 memo append
- Quick Memo 후속 액션: task로 변환, 별도 note로 승격, memo link 복사
- Dataview 호환 frontmatter 정리
- meeting note UI
- wikilink 삽입 helper
- meeting action item과 task 연결 자동화
- backlink-aware task reference
- archive view, 검색, priority filter
- inline body summary 표시 (편집은 Obsidian editor에 위임)

### 14.3 Phase 3. Timeline Removal / Project Workspace Re-evaluation

상세 기록은 `planning/TASK3.md`에서 추적한다.

- Timeline/WBS view 제거.
- task scheduling managed field 제거.
- 기존 scheduling-like frontmatter는 passthrough 보존.
- 향후 planning UX는 project memo와 checklist/outline 중심으로 재검토.

### 14.4 Phase 4. LLM Automation

- 첫 사용 동의 화면 (provider, 전송 범위, opt-out 명시)
- `LLMProvider` interface
- local provider 지원 (Ollama, LM Studio)
- OpenAI-compatible provider 옵션
- provider 설정 UI
- meeting note action item 추출
- 선택 Markdown 기반 draft task 생성

### 14.5 Phase 5. Scale and Mobile

- 대형 board virtualization
- task search와 indexing 최적화
- mobile drag and drop 개선
- write retry queue 강화
- cache rebuild diagnostics
- conflict event diagnostics

## 15. 빌드와 배포

- 빌드 도구: esbuild (Obsidian sample plugin 표준).
- 산출물: `manifest.json`, `main.js`, `styles.css`.
- Phase 1은 manual install과 BRAT 호환 구조를 우선한다.
- Community plugin 제출은 Phase 2 안정화 이후 별도 milestone으로 둔다.
- `manifest.json`의 `id`, `name`, `version`, `minAppVersion`은 release 시 `package.json` version과 함께 갱신한다.
- 릴리스 노트는 `CHANGELOG.md`에 Keep a Changelog 형식으로 관리한다.

## 16. 오픈 이슈

본문에서 결정되지 않고 후속 검토가 필요한 항목.

- 사용자 정의 column schema 지원 시점 (Phase 2 후보).
- project note가 길어질 때 project log를 자동 분리할 기준 (memo 개수, 월 단위, 사용자 설정 중 선택).
- conflict warning을 카드에 표시할 때 시각적 표현 (border, badge 등).

## 17. Milestone 1 완료 정의

Milestone 1은 다음이 모두 동작하면 완료로 본다.

- Obsidian에서 플러그인을 로드할 수 있다.
- Ribbon 또는 command palette로 TaskMaster View를 열 수 있다.
- View 안에 React 기반 Todo, Doing, Done board가 렌더링된다.
- UI에서 task를 만들면 `TaskMaster/Tasks/` 아래 Markdown 파일이 생성된다 (`schemaVersion`, ULID `id`, frontmatter 필드 모두 포함).
- task card를 다른 column으로 이동하면 Markdown frontmatter의 `status`가 바뀐다.
- 같은 column 안의 card 순서가 `board.json`에 저장된다.
- Obsidian을 reload해도 task와 board 순서가 복구된다.
- task Markdown 파일을 직접 수정하면 UI에 반영된다.
- task 삭제와 archive 액션이 동작한다.
- cache 파일을 삭제해도 9.4 알고리즘으로 board가 재생성된다.
- View close와 plugin unload 시 React root, event subscription, pending write가 정리된다.
- 키보드만으로 카드 생성/이동/순서 변경이 가능하다.
- 설정 화면에서 데이터 루트 경로와 debounce 시간을 확인하고 변경할 수 있다.
- 한국어/영어 locale이 동작한다.
- Vitest 단위 테스트가 모두 통과한다.
- 수동 QA checklist 항목이 모두 통과한다.
