# TaskMaster Obsidian Plugin — High-Level Design

- **Version**: 1.0
- **Date**: 2026-05-10
- **Companion docs**: [PRD](PRD.md), [PLAN](PLAN-obsidian-task-manager.md), [ADR Index](adr/README.md)

## 1. 문서 목적

이 HLD는 TaskMaster Obsidian 플러그인의 component-level 구조와 상호작용을 정의한다. PRD의 "what/why"와 PLAN의 "how detail" 사이에서 **시스템 형상**(어떤 모듈이 있고, 어떻게 연결되며, 데이터가 어떻게 흐르는가)을 그린다.

읽는 사람:

- 신규 합류 개발자: 5분 안에 시스템 전체 형상 파악.
- 코드 리뷰어: 변경이 어느 layer를 건드리는지 매핑.
- 외부 통합자: plugin과 외부 시스템(Vault, Sync, LLM) 사이의 경계 이해.

## 2. 시스템 컨텍스트

```
+---------------------------+
|         User              |
+--------------+------------+
               | clicks, types, drags
               v
+--------------+----------------------------------+
|              Obsidian Desktop / Mobile          |
|  +------------+   +-------------+   +--------+  |
|  | ItemView   |   | Vault API   |   | Sync   |  |
|  | (TaskMaster|<->|  files,     |<->|(iCloud,|  |
|  |  React UI) |   |  metadataC. |   | Git,   |  |
|  +------------+   +-------------+   |Obsidian|  |
|         ^                           | Sync)  |  |
|         |                           +--------+  |
|         | mounts                                |
|  +------+--------+                              |
|  | TaskMaster    |                              |
|  | Plugin        |                              |
|  +---------------+                              |
+-------------------------------------------------+
                |
                | Markdown files +
                | .board.json (in Vault)
                | data.json, settings.json
                | (in plugin folder)
                v
       [Vault on disk]
                |
                | (Phase 4)
                v
       [LLM Provider: Ollama / OpenAI-compatible]
       (with explicit user consent)
```

핵심 외부 경계:

- **Vault API**: 모든 파일 read/write, metadataCache, file event.
- **Sync 도구**: 우리 통제 밖. `.board.json`은 Vault 안이라 sync 됨, `data.json`/`settings.json`은 device-local.
- **LLM Provider**: Phase 4, 명시적 동의 후에만.

## 3. 아키텍처 개요

### 3.1 계층 구조

```
+----------------------------------------------------------+
|                   View Layer (React 18)                  |
|  KanbanBoard, KanbanCard, SettingsPane, DiagnosticsPane  |
|  - reads from useTaskMasterStore (Zustand)               |
|  - calls TaskService / BoardService / MeetingService     |
+----------------------------------------------------------+
                            |
                            v  (React → Service)
+----------------------------------------------------------+
|                   Service Layer (POJO classes)           |
|  TaskService, BoardService, MeetingService, IndexService |
|  - business rules                                        |
|  - composes Repositories                                 |
|  - updates Zustand store                                 |
|  - emits domain events to EventBus                       |
+----------------------------------------------------------+
                            |
                            v  (Service → Repository)
+----------------------------------------------------------+
|                 Repository Layer (POJO classes)          |
|  TaskRepository, BoardRepository, MeetingRepository,     |
|  SettingsRepository                                      |
|  - Vault I/O (read, write, trash, rename)                |
|  - frontmatter parse/serialize                           |
|  - debounce, retry, mtime conflict detection             |
|  - subscribes to Vault event                             |
+----------------------------------------------------------+
                            |
                            v
+----------------------------------------------------------+
|                  Obsidian Plugin Host                    |
|  Plugin, ItemView, Vault, MetadataCache, Workspace       |
+----------------------------------------------------------+
```

### 3.2 핵심 원칙

- **단방향 의존**: View → Service → Repository → Obsidian. 역방향 호출 없음.
- **Obsidian API 격리**: Repository만 `obsidian` 모듈을 import. Service와 View는 `obsidian` import 금지 (lint rule로 강제).
- **State는 한 곳**: Zustand store가 단일 source of truth-of-runtime-state. 모든 View와 Service가 같은 store를 본다.
- **Vault는 데이터 source of truth**: store는 Vault에서 derive된 view. store가 비어도 Vault에서 재구성 가능.

### 3.3 Cross-cutting Components

```
+--------------+   +----------------+   +-------------------+
|  EventBus    |   | Diagnostics    |   |  i18n (t function)|
|  (typed      |   |  Log           |   |  ko / en          |
|   emitter)   |   |  (in-memory)   |   +-------------------+
+--------------+   +----------------+
```

- **EventBus**: Plugin core 내부의 비동기 메시지 전달. UI는 store로만 소통하므로 EventBus를 직접 보지 않음.
- **DiagnosticsLog**: 파싱/flush/conflict 실패를 시간순으로 50개까지 메모리 보관. SettingsPane이 표시.
- **i18n**: `t("kanban.column.todo")` 같은 단순 lookup. Obsidian locale에 따라 ko/en 결정.

## 4. Module Breakdown

### 4.1 Module Map

```
src/
├── main.ts                          # Plugin entrypoint
├── view/
│   └── TaskMasterView.ts            # ItemView, React mount/unmount
├── app/
│   ├── App.tsx                      # React root
│   └── providers/
│       └── TaskMasterProvider.tsx   # services + store wiring
├── store/
│   └── taskMasterStore.ts           # Zustand store
├── services/
│   ├── TaskService.ts
│   ├── BoardService.ts
│   ├── MeetingService.ts
│   └── IndexService.ts              # startup scan, Vault event handler
├── repositories/
│   ├── TaskRepository.ts
│   ├── BoardRepository.ts
│   ├── MeetingRepository.ts
│   └── SettingsRepository.ts
├── parser/
│   ├── frontmatter.ts               # parse/serialize, passthrough (ADR-0008)
│   ├── taskMarkdown.ts
│   └── meetingMarkdown.ts
├── core/
│   ├── eventBus.ts
│   ├── ids.ts                       # ULID + short ID 충돌 처리 (ADR-0003)
│   ├── types.ts
│   └── diagnostics.ts
├── ui/
│   ├── kanban/
│   │   ├── KanbanBoard.tsx
│   │   ├── KanbanColumn.tsx
│   │   └── KanbanCard.tsx
│   ├── meetings/
│   ├── settings/
│   │   ├── SettingsPane.tsx
│   │   └── DiagnosticsPane.tsx
│   └── components/
├── i18n/
│   ├── ko.ts
│   ├── en.ts
│   └── index.ts                     # t() function
└── styles/
    └── tailwind.css                 # tm- prefix, scoped to .taskmaster-root
tests/
├── parser/
├── services/
└── repositories/
```

### 4.2 모듈별 책임

| 모듈 | 책임 | 의존 |
| --- | --- | --- |
| `main.ts` | Plugin lifecycle, ribbon, command palette | obsidian |
| `view/TaskMasterView.ts` | ItemView, React mount/unmount | obsidian, react-dom |
| `app/App.tsx` | React tree root | react |
| `app/providers/TaskMasterProvider.tsx` | Service 인스턴스 주입, Vault event 구독 시작 | services, store |
| `store/taskMasterStore.ts` | Zustand store (tasks, board, diagnostics) | zustand |
| `services/*` | 비즈니스 흐름. Repository를 조합하고 store를 갱신 | repositories, store, eventBus |
| `repositories/*` | Vault I/O, debounce, retry, conflict detection | obsidian, parser |
| `parser/*` | Markdown <-> Task/Meeting object 변환 | gray-matter (or 직접 구현) |
| `core/eventBus.ts` | typed pub/sub | (none) |
| `core/ids.ts` | ULID 생성, short ID 충돌 처리 | ulid |
| `ui/*` | React components | react, store, services, lucide-react |
| `i18n/*` | 단순 lookup map | obsidian (locale 감지) |

### 4.3 의존 규칙 (lint로 강제)

```
ui     → store, services, i18n              (✘ obsidian, repositories)
services → repositories, store, eventBus, core  (✘ obsidian, react)
repositories → parser, core, obsidian       (✘ services, store, react)
parser → core                               (✘ obsidian, react, services, repositories)
```

이 의존 규칙은 ESLint `import/no-restricted-paths` 또는 dependency-cruiser로 자동 검증한다.

## 5. Data Flow

### 5.1 Plugin Activation

```
User → Ribbon click
   → main.ts.activateView()
   → TaskMasterView.onOpen()
       → React createRoot
       → mount <App>
           → TaskMasterProvider:
               1. construct Repositories (with App reference)
               2. construct Services (composing Repositories + store)
               3. IndexService.bootstrap():
                  a. ensure folders exist (TaskMaster/, Tasks/, ...)
                  b. scan TaskMaster/Tasks/ via metadataCache
                  c. parse frontmatter (ADR-0005)
                  d. populate store.tasks
                  e. load .board.json or rebuild deterministically
                  f. populate store.board
                  g. subscribe to Vault events
               4. render KanbanBoard (reads from store)
```

### 5.2 Card Move (Status Change)

```
User drags card from Todo → Doing
   → KanbanCard.onDragEnd → KanbanBoard.handleDrop
   → TaskService.moveTask(taskId, "doing")
       1. get current task from store
       2. construct updated task with status="doing", updatedAt=now
       3. await TaskRepository.saveImmediate(updated)   ← ADR-0004
          → mtime conflict check → vault.modify
       4. BoardService.move(taskId, "todo", "doing")
          → store.setBoard(...)
          → BoardRepository.queueWrite() (debounced .board.json)
       5. store.upsertTask(updated)
       6. emit "task:updated"
   → React re-renders affected card via Zustand selector
```

### 5.3 Card Reorder in Same Column

```
User reorders within Doing column
   → KanbanColumn.handleReorder
   → BoardService.reorderInColumn("doing", nextOrder)
       → store.setBoard(...)
       → BoardRepository.queueReorder(...)   ← debounced 500ms (ADR-0004)
   → No Markdown write
   → After 500ms: BoardRepository.flush() → write .board.json
```

### 5.4 External Markdown Modify

```
External tool (Obsidian editor / sync) modifies task file
   → Vault.on("modify", file)
   → IndexService.handleVaultModify(file)
       1. check file is under TaskMaster/
       2. read frontmatter via metadataCache
       3. parse, compare with store.tasks.get(id)
       4. if changed:
          → store.upsertTask(parsed)
          → emit "task:updated"
   → React re-renders
```

### 5.5 Conflict Detection

```
TaskService.saveImmediate(task)
   → TaskRepository.persistTask(task)
       1. compare task.knownMtime vs file.stat.mtime
       2. if file.stat.mtime > task.knownMtime:
          → external change detected
          → re-read file (vault.read, not cachedRead — ADR-0005)
          → attempt field-level merge:
             - non-overlapping field changes → merge silently
             - overlapping → create conflicted copy
                TaskMaster/Tasks/{title} - conflict {timestamp}.md
                emit "vault:conflict"
                show Notice
       3. else: vault.modify(file, serialized)
       4. update task.knownMtime
```

### 5.6 Plugin Unload

```
User disables plugin or quits Obsidian
   → main.ts.onunload()    ← sync function (ADR-0004)
       1. void taskRepository.flush()    (fire-and-forget)
       2. void boardRepository.flush()   (fire-and-forget)
       3. workspace.detachLeavesOfType(VIEW_TYPE_TASKMASTER)
   → TaskMasterView.onClose():
       → root.unmount()
       → unsubscribe Vault events (via Plugin.register)
```

의미 데이터는 평소 즉시 flush되므로 onunload 시점의 pending은 .board.json reorder 정도만 남는다 (손실 시 PRD §9.4로 회복).

## 6. Storage Layout

### 6.1 디스크 위치

```
[Vault]/
├── TaskMaster/
│   ├── Tasks/
│   │   ├── 웹사이트 리뉴얼 1차 회의 - task_01HX7SM2.md
│   │   ├── 마이페이지 리프레시 - task_01HX9P3C.md
│   │   └── ...
│   ├── Meetings/
│   │   └── 웹사이트 킥오프 - meeting_01HX7T4A.md
│   ├── Projects/
│   │   └── 웹사이트 리뉴얼 - project_01HX9C5K.md
│   ├── Archive/
│   │   └── 폐기된 task - task_01HW8000.md
│   └── .board.json                      ← visual order, sync됨 (ADR-0002)
└── .obsidian/
    └── plugins/
        └── taskmaster-plugin/
            ├── manifest.json
            ├── main.js
            ├── styles.css
            ├── data.json                ← in-memory index cache (device-local)
            └── settings.json            ← user preferences (device-local)
```

### 6.2 데이터 책임 매트릭스

| 데이터 | 위치 | Source of Truth | Sync? | 손상 시 회복 |
| --- | --- | --- | --- | --- |
| Task 의미 데이터 (status, title, priority, project) | Markdown frontmatter | Markdown | yes (Vault) | 사용자 데이터, 회복 불가 |
| Task 본문 | Markdown body | Markdown | yes (Vault) | 사용자 데이터, 회복 불가 |
| Meeting | Markdown | Markdown | yes (Vault) | 사용자 데이터, 회복 불가 |
| Project | Markdown | Markdown | yes (Vault) | 사용자 데이터, 회복 불가 |
| Visual order | `.board.json` | `.board.json` | yes (Vault) | PRD §9.4 알고리즘 |
| Status visibility (`hiddenStatuses`) | `settings.json` | settings.json | no (device-local) | 기본값으로 복구 |
| In-memory index | `data.json` | derive from Markdown | no (device-local) | scan으로 재생성 |
| Settings | `settings.json` | settings.json | no (device-local) | 기본값으로 복구 |

## 7. Key Components

### 7.1 IndexService

플러그인 부팅 시 한 번 실행되는 entrypoint. 다음 책임을 가진다.

- `TaskMaster/` 폴더 구조 보장 (없으면 생성).
- Vault scan으로 모든 task/meeting/project를 index.
- `.board.json` 로드 또는 결정적 재구성.
- Vault event 구독 등록.
- Vault event를 받아 store와 Repository에 라우팅.

```ts
class IndexService {
  async bootstrap(): Promise<void> {
    await this.ensureFolders();
    const tasks = await this.taskRepo.findAll();
    const meetings = await this.meetingRepo.findAll();
    const projects = await this.projectRepo.findAll();
    this.store.setTasks(tasks);
    this.store.setMeetings(meetings);
    this.store.setProjects(projects);

    const board = await this.boardRepo.loadOrRebuild(tasks);
    this.store.setBoard(board);

    this.registerVaultListeners();
  }

  private registerVaultListeners() {
    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => this.handleModify(file)),
    );
    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => this.handleDelete(file)),
    );
    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) =>
        this.handleRename(file, oldPath),
      ),
    );
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => this.handleMetaChanged(file)),
    );
  }
}
```

`Plugin.registerEvent`로 등록하면 plugin unload 시 자동 dispose된다 (lifecycle leak 방지).

### 7.2 TaskService

비즈니스 흐름의 중심. React component가 호출하는 주 진입점.

```ts
class TaskService {
  async createTask(input: CreateTaskInput): Promise<Task> { ... }
  async moveTask(taskId: string, nextStatus: TaskStatus): Promise<Task> { ... }
  async updateTitle(taskId: string, title: string): Promise<Task> { ... }
  async updatePriority(taskId: string, priority: Priority | null): Promise<Task> { ... }
  async archiveTask(taskId: string): Promise<void> { ... }
  async deleteTask(taskId: string): Promise<void> { ... }
}
```

모든 메서드는 다음 패턴을 따른다.

1. store에서 현재 상태 read.
2. updated entity 구성.
3. Repository에 persist (의미 데이터는 saveImmediate, 시각만 queue).
4. store 갱신.
5. EventBus emit (cross-component 알림 필요한 경우만).

### 7.3 BoardService

`.board.json`을 다루는 모든 작업의 진입점.

```ts
class BoardService {
  async loadOrRebuild(tasks: Task[]): Promise<BoardState> { ... }
  move(taskId: string, from: ColumnId, to: ColumnId): void { ... }
  reorderInColumn(columnId: ColumnId, nextOrder: string[]): void { ... }
  remove(taskId: string): void { ... }
  append(columnId: ColumnId, taskId: string): void { ... }

  async flush(): Promise<void> { ... }
}
```

reorder는 store만 즉시 갱신하고 디스크는 debounce flush. move/remove/append는 status change와 결합되어 Markdown immediate flush와 함께 board도 동기 갱신.

### 7.4 TaskRepository

I/O와 동시성 처리. ADR-0004, 0005, 0008의 정책이 모두 여기서 구체화된다.

```ts
class TaskRepository {
  async findAll(): Promise<Task[]>             // metadataCache 기반 (ADR-0005)
  async readBody(taskId: string): Promise<string>
  async create(task: Task): Promise<void>      // immediate write
  async saveImmediate(task: Task): Promise<void>
  queueSave(task: Task): void                  // debounced (Phase 1 사용처 적음)
  async archive(taskId: string): Promise<void> // file rename + frontmatter update
  async delete(taskId: string): Promise<void>  // app.vault.trash
  async flush(): Promise<void>
}
```

내부:

- `pendingSaves: Map<id, Task>` — 같은 id 자동 병합.
- `flushInFlight: Promise<void> | null` — 동시 호출 직렬화.
- `pathById: Map<id, path>` — id → 파일 경로 매핑 (rename에 따라 업데이트).
- exponential backoff retry + retry queue.

### 7.5 BoardRepository

`.board.json`만 담당. metadataCache는 사용 안 함 (JSON 파일이라).

```ts
class BoardRepository {
  async load(): Promise<BoardState | null>
  async rebuildFromTasks(tasks: Task[]): Promise<BoardState>  // PRD §9.4 알고리즘
  async loadOrRebuild(tasks: Task[]): Promise<BoardState>
  queueWrite(board: BoardState): void   // debounced 500ms
  async flush(): Promise<void>
  async resolveSyncConflict(local: BoardState, remote: BoardState): Promise<BoardState>
}
```

### 7.6 frontmatter parser

Passthrough 정책 (ADR-0008) 구현이 핵심.

```ts
interface ParsedFrontmatter {
  managed: TaskFrontmatter;       // 우리가 관리하는 field들
  passthrough: Record<string, unknown>; // unknown field들, 원본 보존
  fieldOrder: string[];           // 직렬화 시 순서 보존
}

function parse(raw: string): { fm: ParsedFrontmatter; body: string }
function serialize(fm: ParsedFrontmatter, body: string): string
```

write 시 `managed` field만 갱신하고 `passthrough`는 그대로 유지하며, `fieldOrder`로 가능한 한 원본 순서를 보존한다.

### 7.7 Zustand Store

```ts
interface TaskMasterStore {
  // state
  tasks: Map<string, Task>;
  meetings: Map<string, Meeting>;
  projects: Map<string, Project>;
  board: BoardState;
  diagnostics: readonly DiagnosticEntry[];
  selectedProjectId: string | null;  // filter
  hideCompleted: boolean;

  // actions (Service에서 호출)
  setTasks: (tasks: Task[]) => void;
  upsertTask: (task: Task) => void;
  removeTask: (id: string) => void;
  setBoard: (board: BoardState) => void;
  recordDiagnostic: (entry: DiagnosticEntry) => void;
  setProjectFilter: (id: string | null) => void;
  setHideCompleted: (hide: boolean) => void;
}
```

React component는 selector로 필요한 slice만 구독:

```tsx
const tasks = useTaskMasterStore(s => s.tasks);
const todoColumn = useTaskMasterStore(s => s.board.columns[0]);
```

## 8. UI Architecture

### 8.1 Component Tree

```
<TaskMasterView>
  <TaskMasterProvider services={...} store={...}>
    <App>
      <BoardHeader>
        <ProjectSelector />            ← Phase 1 추가 (Project 최소 UI)
        <HideCompletedToggle />
        <NewTaskButton />
      </BoardHeader>
      <ProjectContextHeader />          ← Phase 2: selected project memo entrypoint
      <KanbanBoard>
        <StatusVisibilityBar />         ← UI-only hidden status control
        <KanbanColumn id="hold">
          <KanbanCard taskId="..." />
          ...
        </KanbanColumn>
        <KanbanColumn id="todo"> ... </KanbanColumn>
        <KanbanColumn id="doing"> ... </KanbanColumn>
        <KanbanColumn id="in-review"> ... </KanbanColumn>
        <KanbanColumn id="done"> ... </KanbanColumn>
      </KanbanBoard>
    </App>
  </TaskMasterProvider>
</TaskMasterView>
```

### 8.2 Kanban Card 인터랙션

| 액션 | 데스크탑 | 모바일 (ADR-0009) | 키보드 (ADR-0010 + a11y) |
| --- | --- | --- | --- |
| 다른 column 이동 | drag and drop | "다음 status" 화살표 버튼 | `Cmd/Ctrl+Enter` |
| 같은 column 재정렬 | drag and drop | 컨텍스트 메뉴 | `Cmd/Ctrl+↑/↓` |
| 상세 보기 | click → Obsidian editor | tap → Obsidian editor | `Enter` |
| Archive | 컨텍스트 메뉴 | 컨텍스트 메뉴 | `Cmd/Ctrl+E` |
| Delete | 컨텍스트 메뉴 → confirm | 컨텍스트 메뉴 → confirm | `Cmd/Ctrl+Delete` |
| Title 편집 | inline (double click) | inline (long-press → edit) | `F2` |

### 8.3 Project Selector (Phase 1)

```
+-----------------+
| All ▼           |
+-----------------+
| ✓ All           |
|   No project    |
|   ─────         |
|   웹사이트 리뉴얼 |
|   마이페이지     |
|   ─────         |
|   + New project |
+-----------------+
```

"+ New project" 클릭 시:

1. 간단한 Modal로 project 이름 입력.
2. ProjectService.create({ title }) 호출.
3. `TaskMaster/Projects/{title} - project_xxx.md` 생성.
4. Phase 2부터 project note body에는 `Goal`, `Current Status`, `Decisions`, `References`, `Quick Notes` 기본 섹션을 생성한다.
5. ProjectSelector에 즉시 추가.

이 최소 UI로 사용자가 task에 project를 attach할 수 있게 된다.

### 8.4 Project Context Header와 Quick Memo (Phase 2)

Project가 선택된 상태에서는 보드 상단에 project context를 노출한다. 목적은 project를 단순 filter가 아니라 작업 맥락의 home note로 느끼게 하는 것이다.

```
+------------------------------------------------------------------+
| Checkout Renewal                         [Open memo] [New task] |
| 목표/상태 preview 또는 최근 quick memo 1~2줄                     |
| [빠른 메모 추가...]                         [Save]              |
+------------------------------------------------------------------+
```

핵심 정책:

- quick memo는 기본적으로 메모마다 별도 page를 만들지 않는다.
- 저장 시 selected project note의 `## Quick Notes` 아래, 오늘 날짜 heading(`### YYYY-MM-DD`)에 bullet로 append한다.
- 각 memo bullet 첫 줄 끝에는 `^tm-memo-<ULID>` 형식의 Obsidian block reference를 붙인다.
- TaskMaster 내부 marker 대신 Obsidian-native block id를 사용해 copy link, convert to task, promote to note가 같은 식별자를 공유한다.
- 독립 문서가 필요한 memo만 사용자가 "Promote to note" 액션으로 별도 note로 승격한다.
- "Convert to task"는 memo 내용을 task title/body 초안으로 사용하고, 현재 project id를 자동 부여한다.
- "Open memo"는 project note를 Obsidian editor에서 바로 연다.

UI/Service 경계:

- React UI는 `ProjectMemoComposer`, `ProjectMemoPreview`, `ProjectMemoActions`로 나눈다.
- Service layer는 `ProjectMemoService.appendMemo(projectId, text)`와 `ProjectMemoService.promoteMemo(...)`를 제공한다.
- Repository layer는 project Markdown body를 read/modify하고, Quick Notes 섹션 생성/append를 담당한다.
- Phase 2 초기 구현은 project note append만 제공하고, 월간/주간 log 파일 분리는 usage feedback 이후 검토한다.

### 8.5 Removed: Timeline / WBS View

Timeline/WBS view는 2026-05-11 사용성 점검 후 제거했다. 현재 HLD의 활성 UI 구조는 Board, Archive, Project memo, Meeting flow에 집중한다.

유지 정책:

- Timeline 전용 component와 state는 만들지 않는다.
- task scheduling field는 managed schema에 포함하지 않는다.
- 기존 노트에 남은 `startDate`, `dueDate`, `milestone`은 ADR-0008 passthrough 정책으로 보존한다.
- 향후 planning UX는 날짜 축보다 project workspace 안의 checklist/outline affordance로 검토한다.

## 9. Cross-cutting Concerns

### 9.1 Accessibility (PRD §10.6)

- 모든 interactive element는 키보드로 도달 가능.
- 카드 = `<li role="listitem" aria-label="{title}, status: {status}, priority: {priority}">`.
- column = `<ul role="list" aria-label="{column title}">`.
- status visibility chip bar = `aria-label="Visible statuses"` + chip `aria-pressed`; mobile tablist와 label을 분리한다.
- focus ring은 `var(--interactive-accent)` CSS variable 사용.
- color로만 상태를 표현하지 않음 (column 위치 + 텍스트 라벨 병기).
- 키보드 단축키 cheat sheet은 SettingsPane에 노출.

### 9.2 Internationalization (PRD §8.8)

```ts
// src/i18n/index.ts
import ko from "./ko";
import en from "./en";
import { moment } from "obsidian";

const locales = { ko, en } as const;
type LocaleKey = keyof typeof locales;
type StringKey = keyof typeof ko;

const current = locales[detectLocale()];

export function t(key: StringKey): string {
  return current[key] ?? en[key] ?? key;
}
```

- ko/en 모듈은 동일한 key 집합을 가져야 하며 TypeScript 타입으로 강제.
- 사용자 데이터(task title 등)는 i18n 대상 아님.
- Phase 1은 plugin 시작 시 locale을 결정하고 변경 시 reload 필요 (간단성).

### 9.3 Diagnostics (PRD §8.7)

- 파싱 실패, conflict, flush retry 실패는 `DiagnosticsLog.record()`에 기록.
- 최근 50개 메모리 보관, console에는 `[TaskMaster]` prefix로 출력.
- SettingsPane → DiagnosticsPane에서 시간 역순 표시.
- 사용자 영향 큰 실패는 Obsidian Notice로도 안내 (실패 종류별 5초 throttle).
- Phase 2 hardening에서는 `DiagnosticsLog`와 Zustand `store.diagnostics`를 단일 경로로 연결해 SettingsPane에 실제 runtime diagnostics가 즉시 표시되게 한다.

### 9.4 Performance (PRD §10.2)

- 보드 초기 렌더링: metadataCache 사용으로 1000 task 1초 이내.
- card drag: 60fps, frame drop 인지되지 않음.
- Markdown write: status는 즉시, reorder는 task당 1회/초 이하.
- 외부 modify 반영: 250ms 이내.
- 가상화는 Phase 5까지 도입하지 않음 (Phase 1-3 task 수 가정 < 1000).

### 9.5 Security & Privacy (PRD §10.3)

- Phase 1-3: 외부 네트워크 호출 없음.
- Phase 4 LLM 도입 시 **첫 호출 전 명시적 동의 화면** 표시.
- local provider(Ollama, LM Studio)와 cloud provider 분리, 동의 범위 명시.

## 10. Build & Deployment

```
src/  →  esbuild bundle  →  dist/main.js
                          →  dist/manifest.json
                          →  dist/styles.css
                                  ↓
                          [User Vault]/.obsidian/plugins/taskmaster-plugin/
                                  ↓
                          (manual install / BRAT)
```

- 빌드: `npm run build` → esbuild + manifest/styles copy.
- 배포: GitHub Releases에 위 3개 파일 첨부.
- Community plugin 제출은 Phase 2 안정화 이후.

## 11. Testing Strategy

| Layer | Tool | Coverage |
| --- | --- | --- |
| parser | Vitest | round-trip (ADR-0008 passthrough 검증), 잘못된 input |
| repositories | Vitest + Obsidian mock | queueSave 병합, flushInFlight 직렬화, retry, conflict |
| services | Vitest | 상태 전환 시 immediate vs queue 분기, store 갱신 |
| store | Vitest | action 결과, selector 동작 |
| ids | Vitest | ULID 생성, short ID 충돌 처리 |
| view | manual QA checklist | lifecycle leak, multi-leaf, 외부 modify 반영 |
| e2e | (Phase 1 제외) | Phase 5 검토 |

QA checklist 핵심 항목 (Milestone 1 시점 문서화, PRD §10.7):

- View open/close 50회 반복 → 메모리 stable
- 두 leaf에 동시 view → 동기화 확인
- `.board.json` 삭제 후 reload → 결정적 재구성
- iOS/Android Obsidian 액션 버튼 동작
- 키보드만으로 보드 운영 가능

## 12. Phasing Map

| Phase | HLD에서 활성화되는 모듈 |
| --- | --- |
| Phase 1 | 위 모든 module 기본 동작 (LLM 제외) |
| Phase 2 | usability hardening, project quick memo, meetings/, archive view, search/filter, inline body summary |
| Phase 3 | Timeline removal, project workspace UX 재평가 |
| Phase 4 | `services/LLMService.ts`, `repositories/LLMProviderRepository.ts`, 동의 화면 |
| Phase 5 | virtualization wrapper, mobile dnd, write retry queue 강화 |

각 phase는 새로운 module을 추가하되 ADR-0001 ~ 0011의 결정을 깨지 않는다. 결정이 바뀌면 새 ADR로 supersede한다.

## 13. Open Architectural Questions

다음은 명세 단계에서 결정하지 않고 구현 중에 결정해도 충분한 항목.

- Zustand store를 persist할지(`zustand/middleware/persist`로 device-local UI state 저장) (Phase 2 filter UI 안정화 시 결정).
- 다중 view 시 selector 단위 re-render 외에 추가 batching이 필요한지 (실제 측정 후 결정).
- Settings 화면을 Obsidian SettingTab에 둘지, TaskMaster View 안에 둘지 (둘 다 가능, UX 디자인에 의존).
- Project note가 길어질 때 월간/주간 log 파일로 자동 분리할 기준.

이 항목들은 결정이 되면 해당 시점에 ADR-0011, 0012, ...로 추가한다.
