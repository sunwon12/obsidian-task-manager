# TaskMaster Obsidian 플러그인 개발 명세서

## 1. 개요

TaskMaster는 React 기반의 프로젝트/칸반 관리 앱을 Obsidian 커스텀 플러그인으로 포팅하는 프로젝트입니다. 기존 React UI의 사용성을 유지하면서, 모든 데이터는 사용자의 로컬 Obsidian Vault 안에 Markdown과 JSON 파일로 저장합니다.

이 문서는 **어떻게** 만드는지를 다룹니다. **무엇을, 왜** 만드는지는 `planning/PRD.md`를 참조합니다. 데이터 스키마처럼 양쪽이 모두 다뤄야 하는 항목은 PRD가 "필드와 의미", PLAN이 "예시와 직렬화 형식"을 담당합니다.

핵심 방향:

- **로컬 우선**: 모든 데이터는 로컬 Vault 내부에만 저장합니다.
- **Obsidian 생태계 활용**: 작업, 회의록, 프로젝트 문서를 `[[wikilink]]`로 기존 노트와 연결합니다.
- **React 기반 작업 화면**: React 18로 만든 칸반 UI를 Obsidian의 `ItemView` 안에 렌더링합니다.
- **유지보수 가능한 구조**: React UI가 Obsidian Vault API에 직접 의존하지 않도록 Service/Repository 계층을 둡니다.

## 2. 기술 스택과 버전

| 항목 | 결정 | 비고 |
| --- | --- | --- |
| 언어 | TypeScript 5.x | strict mode |
| UI | React 18 | 19는 dnd-kit 검증 후 Phase 4에서 검토 |
| 스타일 | Tailwind CSS v3 | v4는 prefix/preflight API 변동 중이므로 보류 |
| dnd | `@dnd-kit/core`, `@dnd-kit/sortable` | 모바일은 dnd 미사용 |
| 아이콘 | `lucide-react` | tree-shaking 가능한 import만 사용 |
| 빌드 | esbuild | Obsidian sample plugin 표준 |
| 테스트 | Vitest | jsdom 환경 |
| 패키지 매니저 | npm | sample plugin과 정렬 |
| Obsidian | `minAppVersion: 1.5.0` | manifest 기준 |

## 3. 시스템 아키텍처

```txt
React UI
  -> Service Layer
    -> Repository Layer
      -> Obsidian Vault API
        -> Markdown files / JSON cache
```

### View Layer

- React 18
- Tailwind CSS v3 with `tm-` prefix
- dnd-kit 기반 Kanban drag and drop (desktop/tablet)
- 모바일은 status tab + "다음 status로 이동" 버튼 (dnd 미사용)
- lucide-react 아이콘

### Host Layer

- Obsidian Plugin API
- 플러그인 생명주기 관리를 위한 `Plugin`
- 작업 화면 렌더링을 위한 `ItemView`
- Ribbon icon과 command palette command

### Service Layer

Service는 비즈니스 흐름을 담당합니다.

- task 생성/수정/삭제/archive
- task 상태 변경
- board card 재정렬
- meeting note 생성
- meeting action item과 task 연결
- Vault 파일 기반 index rebuild

React component는 Repository를 직접 호출하지 않고 Service를 호출합니다. Repository 직접 접근은 `TaskMasterProvider` 같은 boundary 계층에서만 허용합니다.

### Repository Layer

Repository는 저장소 접근과 persistence 세부 구현을 담당합니다.

- Markdown 파일 읽기/쓰기
- frontmatter 파싱
- JSON cache 관리
- Vault write debounce 또는 batch 처리
- Vault 변경 이벤트 구독

#### Vault Read 정책

성능을 위해 read API 사용을 다음과 같이 분기합니다.

| 상황 | API | 비고 |
| --- | --- | --- |
| 보드 렌더링용 frontmatter | `app.metadataCache.getFileCache(file)?.frontmatter` | Obsidian이 이미 캐싱, 거의 무료 |
| Detail panel의 본문 | `app.vault.cachedRead(file)` | 마지막으로 알려진 내용, 일반적으로 충분 |
| Conflict-sensitive write 직전 | `app.vault.read(file)` | 디스크에서 직접 읽어 mtime 비교 정확도 보장 |

`app.vault.getMarkdownFiles()` 자체는 비용이 작지만, 그 결과의 모든 파일에 대해 `vault.read()`를 호출하면 큰 Vault에서 5~15초가 걸립니다. 보드 초기 스캔은 반드시 metadataCache를 통과합니다.

### Data Layer

모든 데이터는 Vault 안에 저장합니다.

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

`.board.json`은 의도적으로 Vault 안에 둡니다. `.obsidian/plugins/` 폴더는 대부분의 sync 도구가 기본 제외하므로, 카드 시각 순서를 device 간에 공유하려면 Vault 안에 있어야 합니다 (PRD 9.1, 9.4 참조).

## 4. 저장 전략

TaskMaster는 Markdown과 JSON을 함께 사용하는 hybrid storage model을 사용합니다.

### Markdown을 Source of Truth로 사용

사용자가 오래 보관해야 하는 의미적 데이터의 원본은 Markdown 파일입니다.

Markdown으로 저장할 데이터:

- task
- meeting
- project note
- decision, action item, 긴 설명, 메모
- 다른 Obsidian note와의 연결

Task 파일 예시 (필드 의미는 PRD 9.2 참조):

```md
---
schemaVersion: 1
id: task_01HX7SM2J6K4XQ7EV6C8T92PPW
type: task
status: doing
project: project_01HX9C5K3D8GHX0Y7T2QN8VFE2
priority: high
createdAt: 2026-05-08T14:30:00+09:00
updatedAt: 2026-05-08T14:45:00+09:00
---

# 웹사이트 리뉴얼 1차 회의

## 결정 사항

- 메인 컬러 유지
- 관련 참고 문서: [[기존 디자인 가이드]]
```

Archive된 Task는 다음 필드를 추가로 가집니다.

```yaml
archivedAt: 2026-05-09T11:00:00+09:00
```

Meeting 파일 예시 (필드 의미는 PRD 9.3 참조):

```md
---
schemaVersion: 1
id: meeting_01HX7T4A0KN9F9RHHKMJ4F5H8A
type: meeting
project: project_01HX9C5K3D8GHX0Y7T2QN8VFE2
date: 2026-05-08
participants:
  - 홍길동
  - 김영희
createdAt: 2026-05-08T15:00:00+09:00
updatedAt: 2026-05-08T16:00:00+09:00
---

# 웹사이트 리뉴얼 킥오프

## 논의 내용

- IA 개편 범위 확인
- 디자인 시스템 적용 범위 논의

## Action Items

- [ ] 랜딩 페이지 와이어프레임 작성
- [ ] [[기존 디자인 가이드]] 검토
```

### JSON은 Cache와 Visual Order로 사용

JSON 파일은 두 가지 책임을 가집니다.

- `.board.json` (Vault 안, sync 됨): 시각적 카드 순서의 **single source of truth**.
- `data.json` (plugin 폴더, device-local): 빠른 조회를 위한 in-memory index의 직렬화 형태(언제든 재생성 가능한 cache).
- `settings.json` (plugin 폴더, device-local): 사용자 설정.

`.board.json`을 시각 순서의 source of truth로 둠으로써, 카드 이동 시 status 변경이 없는 한 Markdown write를 발생시키지 않습니다. 이 경계가 PRD 13.2 "과도한 Vault Write" 리스크를 막습니다.

권장 파일:

```txt
[Vault]/TaskMaster/.board.json
[Vault]/.obsidian/plugins/taskmaster-plugin/data.json
[Vault]/.obsidian/plugins/taskmaster-plugin/settings.json
```

`data.json`은 cache이므로 손상이나 부재 시 `TaskMaster/**/*.md`를 스캔해 다시 생성합니다. `.board.json`은 사용자의 시각 순서 정보이므로 손상 시 PRD 9.4의 결정적 알고리즘으로 재생성합니다. Sync conflict 해소도 PRD 9.4 "Sync Conflict 해소" 정책을 따릅니다 (`updatedAt` 큰 쪽 winner + 누락 taskId append).

## 5. ID, 파일명, Rename 정책

### ID 형식

ID는 ULID 기반 (Crockford Base32, 26자) 이며, prefix로 entity 종류를 표현합니다.

```txt
task_01HX7SM2J6K4XQ7EV6C8T92PPW
meeting_01HX7T4A0KN9F9RHHKMJ4F5H8A
project_01HX9C5K3D8GHX0Y7T2QN8VFE2
```

ULID를 사용하는 이유: 시간 정렬 가능, URL safe, 26자 고정 길이, 분산 환경에서도 충돌 가능성 매우 낮음.

### 파일명 규칙

Task 파일 경로 형식:

```txt
TaskMaster/Tasks/{safe-title} - {short-id}.md
```

- `safe-title`: title에서 OS-illegal 문자(`/ \ : * ? " < > |`) 와 줄바꿈을 `-`로 치환, 양끝 공백 trim, 길이 60자 cap. 한글은 그대로 유지.
- `short-id`: ULID 앞 8자 (예: `task_01HX7SM2`).
- short ID 충돌 시 9, 10, ... 자로 자동 확장. 길이 확장도 충돌하면 결국 풀 ULID까지 늘어납니다.

예시:

```txt
TaskMaster/Tasks/웹사이트 리뉴얼 1차 회의 - task_01HX7SM2.md
```

파일명은 사람이 읽기 위한 보조이며, 실제 entity 매칭은 항상 frontmatter `id` 풀 형식 기준입니다.

### Rename 정책

- Task title 변경 시 Markdown heading을 갱신합니다.
- 파일 rename은 Phase 1에서 자동 수행하지 않습니다 (불필요한 파일 이동을 줄이고 사용자가 Obsidian에서 파일을 관리하는 방식과 정렬).
- 사용자가 파일명을 직접 바꾸더라도 frontmatter `id`를 기준으로 task를 계속 찾습니다.

### 삭제와 Archive

- **삭제**: `app.vault.trash(file, true)` 사용. Obsidian의 시스템 휴지통으로 이동.
- **Archive**: `app.fileManager.renameFile(file, archivePath)`로 `TaskMaster/Archive/` 아래로 이동. 이동 후 frontmatter에 `archivedAt`을 추가하는 second write가 한 번 더 발생합니다.

## 6. 동기화와 Conflict 정책

플러그인은 React UI 밖에서도 파일이 변경될 수 있다고 가정합니다.

외부 변경이 발생할 수 있는 경로:

- 사용자가 Obsidian editor에서 직접 수정
- Obsidian Sync
- Git sync
- iCloud, Dropbox 등 파일 동기화 도구
- 다른 Obsidian plugin

### 시작 시 동작

플러그인 로드 시 다음 순서로 초기화합니다.

1. `TaskMaster/` 하위 폴더가 없으면 생성합니다.
2. `TaskMaster/` 하위 Markdown 파일을 스캔합니다.
3. 지원하는 frontmatter record를 파싱합니다.
4. in-memory index를 다시 만듭니다.
5. JSON cache 파일을 reconcile 또는 regenerate 합니다.
6. 정규화된 in-memory store를 기준으로 React UI를 렌더링합니다.

### Vault Event 처리

다음 Vault event를 구독합니다.

- `create`
- `modify`
- `delete`
- `rename`

Markdown 파일이 변경되면 다음 순서로 처리합니다.

1. 변경된 파일이 TaskMaster 폴더 아래에 있는지 확인합니다.
2. 가능하면 변경된 파일 하나만 다시 파싱합니다.
3. in-memory store를 갱신합니다.
4. plugin event bus를 통해 React UI에 이벤트를 전달합니다.
5. cache 저장을 예약합니다.

### Conflict 처리

초기 버전은 단순하고 예측 가능한 정책을 사용합니다.

- 저장 직전에 마지막으로 알고 있던 file modified time과 현재 file modified time을 비교합니다.
- 로드 이후 파일이 외부에서 변경되었다면 조용히 덮어쓰지 않습니다.
- 최신 파일을 다시 읽고 frontmatter-only 변경은 field 단위 merge를 시도합니다.
- 안전하게 merge할 수 없으면 conflicted copy를 만들고 non-blocking notice를 보여줍니다.
- conflict 발생은 `vault:conflict` event로 UI에 전달되어 카드에 warning state를 표시합니다.

Conflicted copy 예시:

```txt
TaskMaster/Tasks/웹사이트 리뉴얼 1차 회의 - conflict 2026-05-08 145500.md
```

## 7. Kanban Board 저장 방식

PRD 9.4와 정렬해 다음 정책을 따릅니다.

- task 본문과 의미 있는 metadata는 Markdown에 저장합니다.
- task `status`는 의미 있는 상태이므로 Markdown frontmatter에 저장하며, **debounce 없이 즉시 flush**합니다 (PRD 7.3, 13.5의 onunload 손실 방지).
- 시각적인 board ordering은 `.board.json`에 저장합니다 (frontmatter에는 순서 정보를 두지 않습니다).
- 같은 column 안 reorder만 debounce(기본 500ms) 처리합니다. 시각 데이터는 손실되어도 PRD 9.4 알고리즘으로 회복 가능합니다.

`.board.json` 예시:

```json
{
  "version": 1,
  "columns": [
    {
      "id": "todo",
      "title": "Todo",
      "taskIds": ["task_01HX7SM2J6K4XQ7EV6C8T92PPW", "task_01HX7V31..."]
    },
    {
      "id": "doing",
      "title": "Doing",
      "taskIds": ["task_01HX7W9K..."]
    },
    {
      "id": "done",
      "title": "Done",
      "taskIds": []
    }
  ],
  "updatedAt": "2026-05-08T15:00:00+09:00"
}
```

`taskIds`는 풀 ULID 형식을 저장합니다 (file name과 무관).

`.board.json`이 없거나 손상되면 PRD 9.4 알고리즘으로 결정적 재구성합니다. 알고리즘 요약:

```ts
function rebuildBoard(tasks: Task[]): BoardState {
  const grouped = groupBy(tasks, (t) => t.status);
  for (const status of ["todo", "doing", "done"]) {
    grouped[status] = (grouped[status] ?? []).sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) {
        return b.updatedAt.localeCompare(a.updatedAt); // 최근 수정 위로
      }
      return a.fileName.localeCompare(b.fileName);
    });
  }
  return toBoardState(grouped);
}
```

## 8. 플러그인 Bootstrap

### 필수 산출물

Obsidian plugin build는 최종적으로 다음 파일을 만들어야 합니다.

```txt
manifest.json
main.js
styles.css
```

### 권장 의존성

```bash
npm install react react-dom lucide-react @dnd-kit/core @dnd-kit/sortable ulid
npm install -D tailwindcss@^3 postcss autoprefixer typescript esbuild vitest jsdom @vitest/coverage-v8
```

`tailwindcss@^3`로 핀합니다. v4는 prefix/preflight API가 변동 중이라 명세 안정성이 떨어집니다.

### Tailwind 설정 (v3)

Obsidian style과 충돌하지 않도록 Tailwind class에는 namespace를 붙입니다.

```js
// tailwind.config.js
module.exports = {
  prefix: "tm-",
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};
```

사용 예시:

```tsx
<div className="tm-flex tm-gap-2 tm-rounded-md tm-bg-neutral-900" />
```

Obsidian 내부에서는 Tailwind reset style에 의존하지 않습니다. 모든 CSS는 `.taskmaster-root` 하위로 scope됩니다.

### esbuild 설정 (요약)

```js
// esbuild.config.mjs
import esbuild from "esbuild";
import process from "process";

const isProd = process.argv.includes("--prod");

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*"],
  format: "cjs",
  platform: "browser",
  target: "es2020",
  outfile: "dist/main.js",
  sourcemap: !isProd,
  minify: isProd,
  treeShaking: true,
});
```

manifest와 styles.css는 별도 step으로 dist에 복사합니다.

## 9. Obsidian View 연동

`ItemView`를 만들고 `createRoot`로 React를 mount합니다.

```ts
import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import App from "./src/App";

export const VIEW_TYPE_TASKMASTER = "taskmaster-view";

class TaskMasterView extends ItemView {
  private root: Root | null = null;
  private plugin: TaskMasterPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: TaskMasterPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_TASKMASTER;
  }

  getDisplayText() {
    return "TaskMaster";
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();

    const mountPoint = container.createDiv({ cls: "taskmaster-root" });
    this.root = createRoot(mountPoint);
    this.root.render(React.createElement(App, { plugin: this.plugin }));
  }

  async onClose() {
    this.root?.unmount();
    this.root = null;
  }
}

export default class TaskMasterPlugin extends Plugin {
  async onload() {
    this.registerView(
      VIEW_TYPE_TASKMASTER,
      (leaf) => new TaskMasterView(leaf, this),
    );

    this.addRibbonIcon("layout-dashboard", "Open TaskMaster", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-taskmaster",
      name: "Open TaskMaster",
      callback: () => void this.activateView(),
    });
  }

  /**
   * Obsidian의 onunload는 promise return을 기다리지 않습니다.
   * fire-and-forget으로 flush를 호출하되, 결과에 의존하지 않습니다.
   * 의미적 변경은 즉시 flush 정책 (10장 참조) 으로 이미 디스크에 있고,
   * 이 호출은 reorder debounce 잔여만 처리합니다.
   */
  onunload() {
    void this.taskRepository?.flush();
    void this.boardRepository?.flush();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASKMASTER);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TASKMASTER)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_TASKMASTER, active: true });
    }

    workspace.revealLeaf(leaf);
  }
}
```

## 10. Repository와 Service 설계

### Task Repository

Repository는 Vault I/O, debounce, retry, 동시성 처리를 담당합니다.

```ts
import { App, TFile } from "obsidian";

const DEBOUNCE_MS = 500;
const MAX_RETRIES = 3;

export class TaskRepository {
  private readonly app: App;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingSaves = new Map<string, Task>();
  private flushInFlight: Promise<void> | null = null;
  private readonly pathById = new Map<string, string>();

  constructor(app: App) {
    this.app = app;
  }

  /**
   * metadataCache를 우선 사용해 frontmatter만 빠르게 읽는다.
   * 본문이 필요한 경우만 vault.cachedRead()를 호출한다.
   * vault.read() 직접 호출은 피한다 (always reads from disk, slow).
   */
  async findAll(): Promise<Task[]> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith("TaskMaster/Tasks/"));

    const tasks: Task[] = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm || fm.type !== "task") continue;

      // frontmatter만으로 board 렌더링 가능. 본문은 detail panel 열 때 lazy load.
      const task = this.toTask(fm, file);
      if (task) {
        tasks.push(task);
        this.pathById.set(task.id, file.path);
      }
    }
    return tasks;
  }

  /**
   * Task 본문이 필요할 때만 호출. cachedRead는 metadataCache가 알고 있는
   * 마지막 내용을 반환하므로 modify event 직후에는 stale일 수 있다.
   * conflict-sensitive write 직전에는 vault.read()를 사용한다.
   */
  async readBody(taskId: string): Promise<string> {
    const path = this.pathById.get(taskId);
    if (!path) throw new Error(`No path for task ${taskId}`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Missing file: ${path}`);
    const raw = await this.app.vault.cachedRead(file);
    return stripFrontmatter(raw);
  }

  /**
   * 의미적 변경(status, title, archive 등)은 즉시 flush.
   * onunload가 sync여서 promise를 기다리지 않으므로, 의미 데이터는
   * pending 상태로 남기지 않습니다 (PRD 7.3, 13.5 정책).
   *
   * 시각 데이터(reorder)는 BoardRepository에서 debounce 처리합니다.
   * BoardRepository.queueReorder()가 별도로 존재합니다.
   */
  async saveImmediate(task: Task): Promise<void> {
    this.pendingSaves.set(task.id, task);
    await this.flush();
  }

  /**
   * Phase 1에서는 의미 데이터 저장에 사실상 사용하지 않습니다.
   * 향후 inline body 편집 같은 high-frequency 의미 변경이 생길 때를 위해
   * 인터페이스만 유지합니다. 사용 시에는 flush-on-blur 같은 명시적
   * commit point가 필요합니다.
   */
  queueSave(task: Task) {
    this.pendingSaves.set(task.id, task);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /**
   * 동시 호출 안전: 이미 진행 중인 flush가 있으면 그 결과를 공유합니다.
   * flush 도중 들어온 새 queueSave는 다음 flush 사이클에서 처리됩니다.
   */
  async flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    if (this.pendingSaves.size === 0) return;

    const batch = Array.from(this.pendingSaves.values());
    this.pendingSaves.clear();
    this.saveTimer = null;

    this.flushInFlight = this.runBatch(batch).finally(() => {
      this.flushInFlight = null;
      // flush 중 새로 들어온 변경이 있으면 다음 사이클 예약
      if (this.pendingSaves.size > 0) this.scheduleFlush();
    });

    return this.flushInFlight;
  }

  private async runBatch(batch: Task[]): Promise<void> {
    const failures: Task[] = [];
    for (const task of batch) {
      try {
        await this.persistTaskWithRetry(task);
      } catch (err) {
        failures.push(task);
        this.diagnostics.recordFailure(task.id, err);
      }
    }
    if (failures.length > 0) {
      // 일부 실패는 다시 큐에 넣어 다음 사이클에서 retry
      for (const t of failures) this.pendingSaves.set(t.id, t);
      this.notifyUserOfPersistentFailures(failures);
    }
  }

  private async persistTaskWithRetry(task: Task): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.persistTask(task);
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  private async persistTask(task: Task): Promise<void> {
    const path = this.pathById.get(task.id);
    if (!path) throw new Error(`No path for task ${task.id}`);

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Missing file: ${path}`);

    // conflict detection
    if (task.knownMtime && file.stat.mtime > task.knownMtime) {
      await this.handleConflict(task, file);
      return;
    }

    const markdown = serializeTask(task);
    await this.app.vault.modify(file, markdown);
  }

  // parseFile, handleConflict, notifyUserOfPersistentFailures, diagnostics 등은 생략
}
```

핵심 포인트:

- `pendingSaves`는 Map이므로 같은 id 연속 변경이 자동 병합됩니다.
- `flushInFlight` promise로 동시 호출을 직렬화합니다.
- flush 도중 새로 들어온 변경은 다음 사이클로 미뤄 race를 피합니다.
- write 실패는 exponential backoff retry, 최종 실패는 retry queue로 환원하고 사용자에게 안내합니다.
- conflict는 mtime 비교로 감지하고 별도 핸들러로 위임합니다.

### Task Service

Service는 비즈니스 규칙을 담당합니다.

```ts
export class TaskService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly board: BoardRepository,
    private readonly events: EventBus,
  ) {}

  async createTask(input: CreateTaskInput): Promise<Task> {
    const task: Task = {
      schemaVersion: 1,
      id: `task_${ulid()}`,
      type: "task",
      status: input.status ?? "todo",
      project: input.project ?? null,
      priority: input.priority ?? null,
      title: input.title,
      body: input.body ?? "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.tasks.create(task);
    await this.board.appendToColumn(task.status, task.id);
    this.events.emit({ type: "task:created", task });
    return task;
  }

  async moveTask(taskId: string, nextStatus: TaskStatus): Promise<Task> {
    const task = await this.tasks.get(taskId);
    if (task.status === nextStatus) return task;

    const updated: Task = {
      ...task,
      status: nextStatus,
      updatedAt: nowIso(),
    };
    // status는 의미 데이터 → debounce 없이 즉시 디스크 반영
    await this.tasks.saveImmediate(updated);
    await this.board.move(taskId, task.status, nextStatus);
    this.events.emit({ type: "task:updated", task: updated });
    return updated;
  }

  async reorderInColumn(
    columnId: ColumnId,
    nextOrder: string[],
  ): Promise<void> {
    // 시각 데이터 → BoardRepository에서 debounce 처리
    this.board.queueReorder(columnId, nextOrder);
    // Markdown write는 발생하지 않음 (.board.json만 변경)
  }

  async archiveTask(taskId: string): Promise<void> {
    await this.tasks.archive(taskId);
    await this.board.remove(taskId);
    this.events.emit({ type: "task:archived", taskId });
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.tasks.delete(taskId); // app.vault.trash 사용
    await this.board.remove(taskId);
    this.events.emit({ type: "task:deleted", taskId });
  }
}
```

## 11. Event Bus

Plugin core와 React UI는 event bus를 통해 연결합니다. React component가 Obsidian 내부 API에 직접 묶이지 않게 하기 위함입니다.

```ts
export type TaskMasterEvent =
  | { type: "tasks:indexed"; tasks: Task[] }
  | { type: "task:created"; task: Task }
  | { type: "task:updated"; task: Task }
  | { type: "task:deleted"; taskId: string }
  | { type: "task:archived"; taskId: string }
  | { type: "board:updated"; board: BoardState }
  | { type: "vault:conflict"; entityId: string; path: string }
  | { type: "parser:error"; path: string; reason: string };

export class EventBus {
  private readonly listeners = new Set<(e: TaskMasterEvent) => void>();

  subscribe(handler: (e: TaskMasterEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  emit(event: TaskMasterEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[TaskMaster] event handler failed", err);
      }
    }
  }
}
```

초기 버전에서는 작은 typed emitter로 충분합니다. 큰 상태 관리 라이브러리는 Phase 1에서 도입하지 않습니다.

## 12. Diagnostics

```ts
type DiagnosticEntry = {
  ts: string; // ISO datetime
  kind: "parse" | "flush" | "conflict";
  path?: string;
  entityId?: string;
  message: string;
};

export class DiagnosticsLog {
  private readonly entries: DiagnosticEntry[] = [];
  private static readonly MAX = 50;

  record(entry: Omit<DiagnosticEntry, "ts">): void {
    this.entries.push({ ts: new Date().toISOString(), ...entry });
    if (this.entries.length > DiagnosticsLog.MAX) this.entries.shift();
    console.warn("[TaskMaster]", entry);
  }

  list(): readonly DiagnosticEntry[] {
    return this.entries;
  }
}
```

설정 화면 하단의 "Diagnostics" 섹션에서 `list()` 결과를 시간 역순으로 표시합니다.

## 13. 권장 Source Structure

```txt
src/
  main.ts
  view/
    TaskMasterView.ts
  app/
    App.tsx
    providers/
      TaskMasterProvider.tsx
  core/
    eventBus.ts
    ids.ts
    types.ts
    diagnostics.ts
  services/
    TaskService.ts
    BoardService.ts
    MeetingService.ts
  repositories/
    TaskRepository.ts
    BoardRepository.ts
    MeetingRepository.ts
    SettingsRepository.ts
  parser/
    frontmatter.ts
    taskMarkdown.ts
    meetingMarkdown.ts
  ui/
    kanban/
    meetings/
    settings/
    components/
  i18n/
    ko.ts
    en.ts
    index.ts
  styles/
    tailwind.css
tests/
  parser/
  services/
  repositories/
```

## 14. Mobile과 Touch 정책

PRD 8.2와 13.6의 결정에 따라 Phase 1 모바일 정책은 다음과 같이 확정합니다.

- **Mobile은 dnd 미사용**. dnd-kit touch sensor의 scroll 충돌과 long-press 지연을 회피합니다.
- 카드 우측에 "다음 status" 화살표 버튼을 노출합니다.
- 카드 컨텍스트 메뉴(long-press 또는 ⋮ 버튼)에서 "이전 status로 이동", "Archive", "Delete"를 제공합니다.
- 좁은 viewport에서는 status tab + 단일 column grouped list 레이아웃을 사용합니다.
- keyboard가 올라왔을 때 editing layout은 sticky bottom toolbar로 유지합니다.

Tablet (≥ 768px) 부터는 desktop과 동일한 가로 column + dnd를 제공합니다.

## 15. 접근성 (a11y) 구현 가이드

PRD 7.9, 10.6의 요구사항을 다음과 같이 구현합니다.

- 카드는 `<li role="listitem">`, column은 `<ul role="list">`로 markup합니다.
- 카드에 `aria-label="{title}, status: {status}, priority: {priority}"` 부여.
- 키보드 단축키 처리 위치: `KanbanCard` component의 `onKeyDown` 핸들러.
  - `Enter`: 상세 패널 또는 노트 열기
  - `Cmd/Ctrl + Enter`: `taskService.moveTask(id, nextStatus)`
  - `Cmd/Ctrl + Shift + Enter`: `taskService.moveTask(id, prevStatus)`
  - `Cmd/Ctrl + ↑/↓`: `boardService.reorder(...)`
- focus ring은 `:focus-visible`만 사용해 마우스 클릭 시 noise를 줄입니다.
- focus ring 색상은 Obsidian CSS variable (`var(--interactive-accent)`)를 사용합니다.
- color로만 status를 표현하지 않습니다 (column 위치 + 텍스트 라벨 병기).

## 16. i18n

Phase 1 i18n은 외부 라이브러리 없이 단순 lookup으로 처리합니다.

```ts
// src/i18n/index.ts
import ko from "./ko";
import en from "./en";
import { moment } from "obsidian";

const locales = { ko, en } as const;
type LocaleKey = keyof typeof locales;
type StringKey = keyof typeof ko;

function detectLocale(): LocaleKey {
  const obsidianLocale = moment.locale();
  if (obsidianLocale.startsWith("ko")) return "ko";
  return "en";
}

const current = locales[detectLocale()];

export function t(key: StringKey): string {
  return current[key] ?? en[key] ?? key;
}
```

UI 컴포넌트는 `t("kanban.column.todo")`처럼 사용합니다. `ko.ts`와 `en.ts`는 동일한 key 집합을 가져야 하며, 누락은 ts 타입으로 강제합니다.

## 17. 테스트 전략

### Vitest 설정

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    coverage: { provider: "v8", reporter: ["text", "html"] },
    setupFiles: ["./tests/setup.ts"],
  },
});
```

### 필수 단위 테스트 영역

- `parser/frontmatter`: parse, serialize, round-trip 보존
- `parser/taskMarkdown`: 정상 케이스 + 잘못된 frontmatter + 본문 보존
- `repositories/BoardRepository`: rebuild, reorder, recovery
- `repositories/TaskRepository`: queueSave 병합, flushInFlight 직렬화, retry/실패 처리
- `services/TaskService`: 상태 전환 시 Markdown write와 board write 분리 검증
- `core/ids`: ULID 생성과 short ID 충돌 처리
- conflict detection (mtime 비교)
- settings fallback

### 수동 QA Checklist (Milestone 1 시점 문서화)

- View open/close 50회 반복 → memory snapshot 변화 없음
- Vault에 sync tool로 외부 modify → UI 갱신 확인
- `.board.json` 삭제 후 reload → 결정적 재생성 확인
- 1000개 task fixture로 초기 렌더링 측정
- 키보드만으로 카드 생성/이동/순서 변경 가능
- 모바일에서 status tab 전환과 액션 버튼 동작

## 18. 빌드와 배포

### 산출물

- `manifest.json`
- `main.js`
- `styles.css`

### npm scripts

```json
{
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "node esbuild.config.mjs --prod && cp manifest.json styles.css dist/",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

### Manifest

```json
{
  "id": "taskmaster-plugin",
  "name": "TaskMaster",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Local-first task and meeting management with React Kanban inside Obsidian.",
  "author": "TaskMaster Team",
  "isDesktopOnly": false
}
```

### 배포 정책

- Phase 1은 manual install과 BRAT 호환.
- Community plugin 제출은 Phase 2 안정화 이후 별도 milestone.
- release artifact는 GitHub Releases에 `manifest.json`, `main.js`, `styles.css`를 첨부.
- 버전 변경 시 `manifest.json`과 `package.json`을 함께 갱신.

## 19. Roadmap

### Phase 1. 아키텍처와 Obsidian 연동

- plugin scaffold 생성 (esbuild)
- React 18을 `ItemView` 안에 mount
- Tailwind v3 prefix와 preflight 비활성화
- Repository/Service 계층 구현
- task/meeting/project Markdown schema (`schemaVersion: 1`)
- Vault scan과 index rebuild
- `.board.json` ordering cache (single source of truth)
- Vault file change 구독
- 기본 conflict detection
- 키보드 기반 보드 조작
- Task 삭제와 archive
- Diagnostics 화면
- 한국어/영어 i18n
- Vitest 단위 테스트

### Phase 2. Markdown Native Task Management

- task 생성을 완전히 Markdown 기반으로 전환
- Dataview 호환 frontmatter 지원
- project note와 meeting note UI
- wikilink 삽입 helper
- backlink-aware task reference
- archive view, 검색, priority filter
- inline body summary 표시

### Phase 3. Timeline Removal / Project Workspace Re-evaluation

- Timeline/WBS view 제거
- task scheduling managed field 제거
- 기존 scheduling-like frontmatter는 passthrough로 보존
- project memo 중심 planning UX 재검토

### Phase 4. LLM 자동화

- 첫 사용 동의 화면 (provider, 전송 범위, opt-out 명시)
- `LLMProvider` interface 정의
- Ollama 또는 LM Studio 같은 local provider 지원
- 필요 시 OpenAI-compatible provider 지원
- provider 설정을 Obsidian plugin settings로 관리
- meeting note에서 action item 추출
- 선택한 Markdown 내용으로 draft task 생성

### Phase 5. Scale과 Mobile 최적화

- 대형 board를 위한 virtualization
- task search와 indexing 최적화
- mobile drag and drop 개선
- write retry queue 강화
- cache rebuild과 conflict event diagnostics 강화

## 20. 주요 Risk

PRD 13장과 정렬해 동일한 risk 목록을 유지합니다. 본 문서에서는 mitigation의 구현 측면만 추가로 명시합니다.

### Markdown과 JSON Drift

Mitigation: `.board.json`은 시각 순서만, frontmatter는 의미 데이터만 담당. drift 가능성 자체를 책임 분리로 줄입니다.

### 과도한 Vault Write

Mitigation: `pendingSaves` Map으로 같은 id 병합, debounce 500ms, board reorder는 Markdown write를 발생시키지 않음.

### 외부 파일 변경

Mitigation: `persistTask`에서 mtime 비교, conflict 시 conflicted copy 생성.

### CSS 충돌

Mitigation: Tailwind v3 prefix `tm-`, `preflight: false`, `.taskmaster-root` scoped CSS.

### React와 Obsidian Lifecycle Leak

Mitigation:

- `onClose`에서 React unmount, EventBus subscribe는 dispose 함수 반환.
- `onunload`는 sync 함수로 정의하고 `flush()`를 fire-and-forget으로 호출 (Obsidian이 promise를 기다리지 않음).
- 의미 데이터(status, archive, delete, title)는 `saveImmediate`로 즉시 디스크 반영해 onunload 시점에 pending 상태가 남지 않도록 한다.
- 시각 데이터(reorder)만 debounce 처리하며, 손실되어도 PRD 9.4 알고리즘으로 회복된다.

### Mobile dnd 한계

Mitigation: Phase 1 모바일은 dnd 미사용, 명시적 액션 버튼으로 대체.

### LLM Phase 4 Privacy 회귀

Mitigation: Phase 4 첫 LLM 호출 전 명시적 동의 화면 표시. local provider 외에는 동의 없이 호출 차단.

## 21. 구현 Checklist

- [ ] Obsidian sample plugin 기반 scaffold 생성 (esbuild)
- [ ] TypeScript strict mode 설정
- [ ] React 18과 React DOM 추가
- [ ] Tailwind v3 `tm-` prefix와 `preflight: false` 설정
- [ ] dnd-kit과 lucide-react 추가
- [ ] ulid 추가
- [ ] Vitest + jsdom 설정
- [ ] task, meeting, project, board type 정의 (`schemaVersion` 포함)
- [ ] Markdown parser와 serializer 구현 + round-trip 테스트
- [ ] ID 생성과 short ID 충돌 처리 구현 + 단위 테스트
- [ ] 안전한 mount/unmount를 가진 `TaskMasterView` 생성
- [ ] ribbon icon과 command palette command 추가
- [ ] task repository (queueSave, flush, retry, mtime conflict)
- [ ] board repository (rebuild 알고리즘, 손상 복구)
- [ ] settings repository (fallback 처리)
- [ ] service layer (create, move, reorder, archive, delete)
- [ ] startup scan과 cache rebuild
- [ ] Vault event subscription
- [ ] debounced save와 flush-on-unload
- [ ] conflict detection과 conflicted copy
- [ ] Kanban UI (desktop dnd, 키보드 단축키, ARIA)
- [ ] Mobile 액션 버튼 UI
- [ ] Settings UI + Diagnostics 섹션
- [ ] 한국어/영어 i18n
- [ ] desktop Obsidian 동작 검증
- [ ] mobile layout 동작 검증
- [ ] Vitest 단위 테스트 통과
- [ ] 수동 QA checklist 통과

## 22. 권장 첫 Milestone

첫 milestone은 모든 기능을 포팅하는 것이 아니라 아키텍처가 실제로 동작하는지 검증합니다.

범위:

- ribbon에서 TaskMaster view 열기
- 세 개의 Kanban column 표시
- Markdown 파일로 task 생성 (`schemaVersion`, ULID `id` 포함)
- task를 column 사이에서 이동 (마우스 + 키보드)
- status를 Markdown에 저장
- visual order를 `.board.json`에 저장
- Obsidian을 reload해도 board 복구
- task frontmatter를 직접 수정했을 때 UI 갱신
- task 삭제와 archive
- 키보드 단축키로 카드 이동 가능
- 한국어/영어 locale 동작
- Vitest 단위 테스트 통과

이 milestone은 React mount, Vault persistence, Markdown parsing, JSON cache rebuild, event-based synchronization, accessibility 기본 동작이라는 가장 중요한 가정을 검증합니다.
