# TaskMaster Implementation Tasks

- **Version**: 1.0
- **Date**: 2026-05-10
- **Source docs**: [PRD](PRD.md), [PLAN](PLAN-obsidian-task-manager.md), [HLD](HLD.md), [LLD](LLD.md), [ADR Index](adr/README.md)
- **Total estimate**: ~26.5 person-days (≈ 5 weeks for 1 dev, ≈ 3 weeks for 2 devs with parallelism)

## 1. 사용 방법

이 문서는 Phase 1 (Milestone 1) 구현을 위한 작업 분해다. 각 task는 다음 정보를 가진다.

- **ID**: `T-XXX` 형식. 한 번 부여하면 재사용 안 함.
- **Status**: ⬜ (pending) pending / 🟡 in_progress / ✅ done / ⛔ blocked.
- **Estimate**: 0.5d, 1d, 2d 등 (1d = 6 효율적 시간).
- **Dependencies**: 선행되어야 하는 task ID. 없으면 (none).
- **Outputs**: 생성/수정되는 파일 또는 산출물.
- **References**: PRD/HLD/LLD의 관련 섹션.
- **Done when**: 객관적으로 검증 가능한 완료 조건 체크박스.

진행 시:
1. 시작 전 status를 🟡로 변경.
2. Done when 체크박스를 모두 채우면 ✅로 변경.
3. blocker가 발생하면 ⛔로 변경하고 사유 기록.
4. 의존성에 막힌 task는 손대지 않는다.

## 2. Milestone Map

| Milestone | 설명 | Tasks | Estimate |
| --- | --- | --- | --- |
| **M0 Setup** | 빌드 시스템과 lint, test 환경 | T-001 ~ T-006 | 1.5d |
| **M1 Foundation** | types, utilities, parser | T-101 ~ T-110 | 4d |
| **M2 Storage** | Repositories | T-201 ~ T-210 | 5d |
| **M3 Domain** | Services + Store | T-301 ~ T-307 | 3d |
| **M4 Plugin Host** | main.ts, View, Provider | T-401 ~ T-406 | 2d |
| **M5 UI Components** | React Kanban + Project | T-501 ~ T-511 | 5d |
| **M6 Cross-cutting** | i18n, Settings, Diagnostics | T-601 ~ T-605 | 2d |
| **M7 Polish & Validation** | a11y, performance, manual QA | T-701 ~ T-708 | 3d |
| **M8 Release Prep** | docs, BRAT, manifest | T-801 ~ T-805 | 1d |

## 3. 의존성 그래프 (high-level)

```
M0 Setup
   │
   ▼
M1 Foundation ───────────────────┐
   │                             │
   ▼                             │
M2 Storage                       │
   │                             │
   ▼                             │
M3 Domain                        │
   │                             ▼
   ▼                       (i18n는 어디서나 사용)
M4 Plugin Host  ◄──── M6 Cross-cutting (병렬 가능)
   │
   ▼
M5 UI Components
   │
   ▼
M7 Polish & Validation
   │
   ▼
M8 Release Prep
```

**병렬 작업 힌트:**
- M1 안에서 `core/*`(T-101~T-106)는 모두 병렬 가능.
- M2 안에서 SettingsRepo(T-201)와 Meeting/ProjectRepo(T-209~T-210)는 다른 dev가 동시에 가능.
- M5의 UI components 다수는 store 인터페이스만 정해지면 병렬 가능.
- M6 i18n(T-601)은 M5와 병렬로 진행 가능.
- M7의 manual QA 항목들은 서로 독립.

---

## M0. Setup

### T-001 — 프로젝트 scaffold
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: (none)
- **Outputs**: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `.gitignore`
- **References**: LLD §14.1, §14.2
- **Done when**:
  - [ ] `npm install`로 모든 deps 설치 (`react`, `react-dom`, `lucide-react`, `@dnd-kit/core`, `@dnd-kit/sortable`, `ulid`, `zustand`, dev: `tailwindcss@^3`, `postcss`, `autoprefixer`, `typescript`, `esbuild`, `vitest`, `jsdom`, `@vitest/coverage-v8`, `obsidian` types)
  - [ ] `npm run build` 성공 → `dist/main.js` 산출
  - [ ] `tsc --noEmit` 통과 (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes)

### T-002 — ESLint + dependency 강제
- **Status**: ✅ done (2026-05-10, ESLint v9 flat config + import/no-restricted-paths 검증 완료)
- **Estimate**: 0.25d
- **Dependencies**: T-001
- **Outputs**: `.eslintrc.cjs`, `package.json` (lint script)
- **References**: LLD §14.4
- **Done when**:
  - [ ] `import/no-restricted-paths` 규칙으로 ui→repositories, ui→obsidian, services→obsidian, services→react, parser→obsidian 차단
  - [ ] `npm run lint` 정상 통과 (빈 src에서)
  - [ ] 위반 사례 fixture로 일부러 만들면 lint가 잡는지 확인 후 제거

### T-003 — Vitest 환경
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-001
- **Outputs**: `vitest.config.ts`, `tests/setup.ts`, `tests/__mocks__/obsidian.ts`
- **References**: LLD §13, PLAN §17
- **Done when**:
  - [ ] `vitest run` 빈 테스트 통과
  - [ ] obsidian 모듈 mock으로 App, TFile, TFolder, Vault, MetadataCache, Notice, normalizePath 노출
  - [ ] coverage report 생성 확인

### T-004 — Tailwind v3 + Obsidian variable 매핑
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-001
- **Outputs**: `tailwind.config.js`, `postcss.config.js`, `src/styles/tailwind.css`, build script에 css 빌드 추가
- **References**: ADR-0006, LLD §14.3
- **Done when**:
  - [ ] `tm-` prefix와 `preflight: false` 설정
  - [ ] Obsidian CSS variable 매핑 (`tm-bg`, `tm-text`, `tm-accent`, `tm-border` 등)
  - [ ] `dist/styles.css`로 빌드 산출

### T-005 — manifest.json 작성
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.1d
- **Dependencies**: (none)
- **Outputs**: `manifest.json`
- **References**: PRD §15, LLD §14
- **Done when**:
  - [ ] `id`, `name`, `version`(`0.1.0`), `minAppVersion`(`1.5.0`), `description`, `author`, `isDesktopOnly: false` 모두 채움

### T-006 — 디렉토리 구조 + placeholder 파일
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.15d
- **Dependencies**: T-001
- **Outputs**: `src/`, `tests/` 아래 LLD §3의 모든 폴더와 빈 `index.ts`
- **References**: HLD §4.1, LLD §3
- **Done when**:
  - [ ] HLD §4.1의 모든 디렉토리 존재
  - [ ] 각 모듈에 placeholder export로 build 통과

---

## M1. Foundation

### T-101 — `core/types.ts`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-006
- **Outputs**: `src/core/types.ts`
- **References**: LLD §2
- **Done when**:
  - [ ] LLD §2의 모든 type 정의 (branded ID, Task, Meeting, Project, BoardState, ParsedFrontmatter, TaskFrontmatterDoc, CreateTaskInput, TaskMasterEvent, DiagnosticEntry, PluginSettings, DEFAULT_SETTINGS)
  - [ ] `tsc --noEmit` 통과

### T-102 — `core/ids.ts` + 단위 테스트
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-101, T-003
- **Outputs**: `src/core/ids.ts`, `tests/core/ids.test.ts`
- **References**: ADR-0003, LLD §3.1
- **Done when**:
  - [ ] `newId`, `ulidOf`, `makeShortId`, `isValidId` 구현
  - [ ] 1만 개 ULID 생성 테스트 (충돌 0)
  - [ ] short ID 충돌 시 길이 자동 확장 테스트
  - [ ] `isValidId` 거부 케이스 (잘못된 prefix, 길이, 알파벳)

### T-103 — `core/time.ts`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.1d
- **Dependencies**: T-101
- **Outputs**: `src/core/time.ts`
- **References**: LLD §3.2
- **Done when**:
  - [ ] `nowIso`, `isoDate`, `laterOf` 구현
  - [ ] 단위 테스트 (laterOf 동률 처리 포함)

### T-104 — `core/paths.ts` + 단위 테스트
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-101
- **Outputs**: `src/core/paths.ts`, `tests/core/paths.test.ts`
- **References**: LLD §3.3
- **Done when**:
  - [ ] `safeTitle`, `joinPath`, `isUnderFolder` 구현
  - [ ] illegal 문자, 한글, 빈 입력, 60자 cap 테스트
  - [ ] `isUnderFolder("TaskMaster/Tasks/x.md", "TaskMaster")` 등 경계 case 테스트

### T-105 — `core/eventBus.ts` + 테스트
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-101
- **Outputs**: `src/core/eventBus.ts`, `tests/core/eventBus.test.ts`
- **References**: LLD §10.1
- **Done when**:
  - [ ] subscribe/unsubscribe 동작
  - [ ] handler 예외가 다른 handler를 막지 않음

### T-106 — `core/diagnostics.ts` + 테스트
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-101
- **Outputs**: `src/core/diagnostics.ts`, `tests/core/diagnostics.test.ts`
- **References**: PRD §8.7, LLD §10.2
- **Done when**:
  - [ ] `record`, `list` 동작
  - [ ] 50개 cap 유지
  - [ ] kind별 5초 throttle 검증 (Notice mock으로)

### T-107 — `parser/frontmatter.ts` + 테스트 (passthrough)
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 1d
- **Dependencies**: T-101
- **Outputs**: `src/parser/frontmatter.ts`, `tests/parser/frontmatter.test.ts`
- **References**: ADR-0008, LLD §4.1
- **Done when**:
  - [ ] `parseFile`, `serializeFile` 구현
  - [ ] Round-trip 테스트: parse → serialize → parse 결과가 원본과 동일
  - [ ] passthrough field 보존 (사용자 정의 `tags`, `aliases`, Dataview field 등)
  - [ ] field 순서 보존
  - [ ] 빈 frontmatter, frontmatter 없음, body 안 `---` line 등 edge case
  - [ ] 잘못된 YAML 처리 (throw → 호출자 책임)

### T-108 — `parser/taskMarkdown.ts` + 테스트
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-107, T-102
- **Outputs**: `src/parser/taskMarkdown.ts`, `tests/parser/taskMarkdown.test.ts`
- **References**: LLD §4.2
- **Done when**:
  - [ ] `parseTask`, `serializeTask` 구현
  - [ ] schema 위반 → null 반환 테스트
  - [ ] H1 title 추출 + 갱신
  - [ ] archivedAt이 null이면 frontmatter에서 제거
  - [ ] project/priority 잘못된 값 → null로 graceful degradation

### T-109 — `parser/meetingMarkdown.ts` + 테스트
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-107, T-102
- **Outputs**: `src/parser/meetingMarkdown.ts`, `tests/parser/meetingMarkdown.test.ts`
- **References**: LLD §4.2 (동일 패턴)
- **Done when**:
  - [ ] `parseMeeting`, `serializeMeeting` 구현
  - [ ] participants 배열 직렬화 round-trip
  - [ ] date YYYY-MM-DD 검증

### T-110 — `parser/projectMarkdown.ts` + 테스트
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-107, T-102
- **Outputs**: `src/parser/projectMarkdown.ts`, `tests/parser/projectMarkdown.test.ts`
- **References**: LLD §4.2 (동일 패턴, 단순)
- **Done when**:
  - [ ] `parseProject`, `serializeProject` 구현 (title, id, schemaVersion만)
  - [ ] round-trip 테스트

---

## M2. Storage (Repositories)

### T-201 — `SettingsRepository`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-101
- **Outputs**: `src/repositories/SettingsRepository.ts`, `tests/repositories/SettingsRepository.test.ts`
- **References**: LLD §5.1, PRD §8.9
- **Done when**:
  - [ ] `load`, `save`, `migrate` 구현
  - [ ] 손상 settings → DEFAULT_SETTINGS로 복구 테스트
  - [ ] 부분 settings (일부 field만) → 기본값 병합 테스트

### T-202 — `TaskRepository.findAll` (metadataCache 우선)
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-108, T-104, T-106
- **Outputs**: `src/repositories/TaskRepository.ts` (findAll, readBody, helpers)
- **References**: ADR-0005, LLD §5.2
- **Done when**:
  - [ ] metadataCache.getFileCache로 frontmatter 우선 사용
  - [ ] 본문 미로드 (보드 렌더링용)
  - [ ] schema 위반 파일 1개가 전체를 깨지 않음 (diagnostics 기록 후 skip)
  - [ ] `readBody`는 frontmatter를 떼고 본문만 반환

### T-203 — `TaskRepository.create`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-202
- **Outputs**: `TaskRepository.create`, `allocatePath`
- **References**: ADR-0003, LLD §5.2
- **Done when**:
  - [ ] safeTitle + short ID로 path 생성
  - [ ] path 충돌 시 short ID 길이 자동 확장
  - [ ] `pathById`, `shortIds` 인덱스 갱신
  - [ ] knownMtime을 생성된 file의 mtime으로 설정

### T-204 — `TaskRepository.saveImmediate + flush + retry`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 1d
- **Dependencies**: T-203
- **Outputs**: `TaskRepository.saveImmediate`, `queueSave`, `flush`, `runBatch`, `persistWithRetry`
- **References**: ADR-0004, LLD §5.2
- **Done when**:
  - [ ] `pendingSaves` Map으로 같은 id 자동 병합
  - [ ] `flushInFlight` promise로 동시 호출 직렬화 — 동시 100회 호출에 race 없음 단위 테스트
  - [ ] flush 도중 들어온 새 변경이 다음 사이클로 미뤄짐
  - [ ] persist 실패 시 exponential backoff retry 3회
  - [ ] 최종 실패는 retry queue로 환원 + diagnostics 기록

### T-205 — `TaskRepository.persist + conflict + conflicted copy`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.75d
- **Dependencies**: T-204
- **Outputs**: `persist`, `handleConflict`, `writeConflictedCopy`
- **References**: ADR-0005 (conflict-sensitive read), LLD §5.2
- **Done when**:
  - [ ] persist는 vault.read()로 mtime 직접 확인
  - [ ] external mtime > knownMtime이면 handleConflict 진입
  - [ ] external 파일이 valid → field-level merge (passthrough 보존)
  - [ ] external이 invalid → conflicted copy 생성 + diagnostics
  - [ ] conflicted copy 파일명 형식: `{title} - conflict YYYYMMDD HHMMSS.md`

### T-206 — `TaskRepository.archive + delete`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-205
- **Outputs**: `archive`, `delete`
- **References**: PRD §7.5, §7.6, LLD §5.2
- **Done when**:
  - [ ] archive: renameFile로 Archive 폴더로 이동 + archivedAt 추가 (saveImmediate 한 번)
  - [ ] delete: app.vault.trash 사용 (시스템 휴지통)
  - [ ] 두 작업 모두 pathById, shortIds 인덱스 갱신
  - [ ] archive된 task의 path가 archive 폴더 아래로 변경됨 단위 테스트

### T-207 — `BoardRepository.load + rebuildFromTasks + reconcile`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-101, T-103
- **Outputs**: `src/repositories/BoardRepository.ts` (load, rebuildFromTasks, loadOrRebuild, reconcile)
- **References**: PRD §9.4, LLD §5.3
- **Done when**:
  - [ ] tryLoad: 파일 없음/JSON parse 실패 → null
  - [ ] rebuildFromTasks: PRD §9.4 알고리즘 (status → updatedAt desc → path asc)
  - [ ] reconcile: task.status 기반 column 결정, archive 제외, 신규 task append
  - [ ] 단위 테스트: 빈 tasks, 손상 JSON, status 이동, archive

### T-208 — `BoardRepository.resolveSyncConflict + queueWrite + flush`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-207
- **Outputs**: `BoardRepository.resolveSyncConflict`, `queueWrite`, `flush`, `persist`
- **References**: ADR-0002, LLD §5.3
- **Done when**:
  - [ ] resolveSyncConflict: 더 큰 updatedAt winner + loser의 missing taskId append
  - [ ] queueWrite debounce 동작 (timer reset)
  - [ ] writeInFlight 동시성 처리
  - [ ] persist는 파일 없으면 create, 있으면 modify

### T-209 — `MeetingRepository`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-109
- **Outputs**: `src/repositories/MeetingRepository.ts`, 테스트
- **References**: LLD §5.4
- **Done when**:
  - [ ] findAll, create, saveImmediate, delete (TaskRepository와 동일 패턴, archive 없음)

### T-210 — `ProjectRepository`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-110
- **Outputs**: `src/repositories/ProjectRepository.ts`, 테스트
- **References**: LLD §5.4
- **Done when**:
  - [ ] findAll, create (Phase 1은 update/delete 미구현)

---

## M3. Domain (Services + Store)

### T-301 — Zustand store
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-101
- **Outputs**: `src/store/taskMasterStore.ts`, `tests/store/taskMasterStore.test.ts`
- **References**: ADR-0007, LLD §7.1
- **Done when**:
  - [ ] State + Actions 정의 (LLD §7.1)
  - [ ] tasks/meetings/projects는 Map 기반
  - [ ] diagnostics 50개 cap
  - [ ] 모든 action 단위 테스트

### T-302 — `store/selectors.ts`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-301
- **Outputs**: `src/store/selectors.ts`, `tests/store/selectors.test.ts`
- **References**: LLD §7.2
- **Done when**:
  - [ ] `useFilteredBoard` 구현 (project filter + hideCompleted)
  - [ ] useMemo로 reference equality 보장
  - [ ] 단위 테스트: filter 적용 후에도 의미 데이터 불변

### T-303 — `IndexService`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.75d
- **Dependencies**: T-202, T-207, T-209, T-210, T-301
- **Outputs**: `src/services/IndexService.ts`, `tests/services/IndexService.test.ts`
- **References**: LLD §6.1
- **Done when**:
  - [ ] `bootstrap`: ensureFolders → findAll 병렬 → store 채움 → board reconcile
  - [ ] Vault listener를 `Plugin.registerEvent`로 등록 (auto-dispose)
  - [ ] handleMetaChanged: status 변경 또는 신규 시 board reconcile
  - [ ] handleDelete, handleRename
  - [ ] 단위 테스트: bootstrap, 외부 modify 반영, polluted file 격리

### T-304 — `TaskService`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-202~T-206, T-301, T-105
- **Outputs**: `src/services/TaskService.ts`, `tests/services/TaskService.test.ts`
- **References**: LLD §6.2
- **Done when**:
  - [ ] createTask, moveTask (no-op 처리), updateTitle, updatePriority, setProject, archiveTask, deleteTask, openInEditor 구현
  - [ ] 의미 변경은 saveImmediate 호출 (queueSave 아님)
  - [ ] 모든 mutation은 store + EventBus 동시 갱신
  - [ ] requireTask가 없으면 throw

### T-305 — `BoardService`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-208, T-301, T-105
- **Outputs**: `src/services/BoardService.ts`, `tests/services/BoardService.test.ts`
- **References**: LLD §6.3
- **Done when**:
  - [ ] appendToColumn, move, reorderInColumn, remove, replace 구현
  - [ ] update가 reference 동등성 유지 (no-op이면 store 변경 없음)
  - [ ] reorderInColumn은 BoardRepository.queueWrite (debounce)

### T-306 — `ProjectService`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-210, T-301
- **Outputs**: `src/services/ProjectService.ts`
- **References**: LLD §6.4, HLD §8.3
- **Done when**:
  - [ ] createProject, list 구현 (Phase 1 최소)

### T-307 — `MeetingService`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-209, T-301
- **Outputs**: `src/services/MeetingService.ts`
- **References**: PRD §7.7
- **Done when**:
  - [ ] createMeeting, openInEditor 구현 (Phase 1)

---

## M4. Plugin Host

### T-401 — `main.ts` (DI wiring)
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-303~T-307, T-201
- **Outputs**: `src/main.ts`
- **References**: LLD §8.1
- **Done when**:
  - [ ] Repositories, Services, Store 의존성 주입 그래프 구성
  - [ ] settings load 후 dataRoot 사용
  - [ ] IndexService.bootstrap을 onload에서 await
  - [ ] ServiceContainer 인터페이스 export

### T-402 — `view/TaskMasterView.ts`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-401
- **Outputs**: `src/view/TaskMasterView.ts`
- **References**: LLD §8.2, HLD §3.2
- **Done when**:
  - [ ] ItemView 등록, getViewType, getDisplayText, getIcon 구현
  - [ ] onOpen에서 createRoot + .taskmaster-root class
  - [ ] onClose에서 root.unmount

### T-403 — `TaskMasterProvider`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-402
- **Outputs**: `src/app/providers/TaskMasterProvider.tsx`
- **References**: LLD §8.3
- **Done when**:
  - [ ] Context.Provider로 ServiceContainer + app 주입
  - [ ] `useServices`, `useStore` hook export

### T-404 — `app/App.tsx`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.1d
- **Dependencies**: T-403
- **Outputs**: `src/app/App.tsx`
- **References**: LLD §9.1
- **Done when**:
  - [ ] TaskMasterProvider로 wrap된 BoardHeader + KanbanBoard placeholder

### T-405 — Ribbon icon + Command palette
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-401
- **Outputs**: `main.ts`에 추가
- **References**: PRD §7.1, LLD §8.1
- **Done when**:
  - [ ] addRibbonIcon으로 view 열기
  - [ ] addCommand "Open TaskMaster"
  - [ ] activateView가 기존 leaf reveal (중복 생성 안 함)

### T-406 — onunload sync flush
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.15d
- **Dependencies**: T-401
- **Outputs**: `main.ts`의 onunload
- **References**: ADR-0004, LLD §8.1
- **Done when**:
  - [ ] onunload는 sync 함수
  - [ ] taskRepo.flush, boardRepo.flush를 fire-and-forget
  - [ ] detachLeavesOfType 호출

---

## M5. UI Components

### T-501 — `KanbanBoard.tsx` (desktop dnd)
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.75d
- **Dependencies**: T-302, T-304, T-305, T-403
- **Outputs**: `src/ui/kanban/KanbanBoard.tsx`
- **References**: LLD §9.2, ADR-0009
- **Done when**:
  - [ ] DndContext + handleDragEnd → taskService.moveTask
  - [ ] useFilteredBoard로 columns 가져오기
  - [ ] useIsMobile 분기로 MobileBoard 전환

### T-502 — `KanbanColumn.tsx`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-501
- **Outputs**: `src/ui/kanban/KanbanColumn.tsx`
- **References**: LLD §9.2
- **Done when**:
  - [ ] useDroppable로 column drop target
  - [ ] role="list" + aria-label (column title)
  - [ ] 카드 정렬 SortableContext

### T-503 — `KanbanCard.tsx` + 키보드 단축키
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 1d
- **Dependencies**: T-502
- **Outputs**: `src/ui/kanban/KanbanCard.tsx`
- **References**: LLD §9.3, PRD §7.9, §10.6, ADR-0010
- **Done when**:
  - [ ] useDraggable + transform style
  - [ ] role="listitem" + 풀 aria-label (title, status, priority)
  - [ ] 키보드 단축키: Enter (open note), Cmd/Ctrl+Enter (next status), +Shift (prev), Cmd/Ctrl+E (archive), Cmd/Ctrl+Delete (delete confirm)
  - [ ] click → openInEditor
  - [ ] focus-visible ring (Obsidian accent variable)

### T-504 — `MobileBoard.tsx` + MobileCard (액션 버튼)
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-302, T-304
- **Outputs**: `src/ui/kanban/MobileBoard.tsx`
- **References**: LLD §9.4, ADR-0009
- **Done when**:
  - [ ] SegmentedControl로 column 전환
  - [ ] 카드에 "다음 status" 화살표 버튼 + aria-label
  - [ ] long-press 또는 ⋮ 메뉴로 archive/delete
  - [ ] dnd 의존 없음

### T-505 — `BoardHeader.tsx`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-404
- **Outputs**: `src/ui/kanban/BoardHeader.tsx`
- **References**: HLD §8.1
- **Done when**:
  - [ ] ProjectSelector + HideCompletedToggle + NewTaskButton 배치

### T-506 — `ProjectSelector.tsx` + 새 프로젝트 modal
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-306, T-301
- **Outputs**: `src/ui/kanban/ProjectSelector.tsx`
- **References**: HLD §8.3
- **Done when**:
  - [ ] All / No project / 각 project / + New project 메뉴
  - [ ] 선택 시 store.setProjectFilter
  - [ ] "+ 새 프로젝트" 클릭 → 입력 modal → projectService.createProject

### T-507 — `HideCompletedToggle.tsx`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.1d
- **Dependencies**: T-301
- **Outputs**: `src/ui/kanban/HideCompletedToggle.tsx`
- **References**: PRD §11
- **Done when**:
  - [ ] toggle UI, store.setHideCompleted

### T-508 — `NewTaskButton.tsx` + 입력 modal
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-304, T-306
- **Outputs**: `src/ui/kanban/NewTaskButton.tsx`
- **References**: PRD §7.2
- **Done when**:
  - [ ] 버튼 → modal 열기
  - [ ] title 입력 + (선택) project, priority
  - [ ] taskService.createTask 호출

### T-509 — `PriorityBadge.tsx`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.1d
- **Dependencies**: T-101
- **Outputs**: `src/ui/components/PriorityBadge.tsx`
- **References**: PRD §10.6 (color만으로 표현 X)
- **Done when**:
  - [ ] priority별 텍스트 라벨 + 색상 (라벨 텍스트도 함께 표시, color blind 친화)

### T-510 — `ConfirmDialog.tsx`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-403
- **Outputs**: `src/ui/components/ConfirmDialog.tsx`
- **References**: PRD §7.5
- **Done when**:
  - [ ] Obsidian Modal API 사용
  - [ ] 메시지, 확인/취소 버튼
  - [ ] settings.confirmOnDelete가 false면 자동 confirm (skip)

### T-511 — `useIsMobile` hook
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.1d
- **Dependencies**: (none)
- **Outputs**: `src/ui/hooks/useIsMobile.ts`
- **References**: LLD §15 (open question으로 기록된 것 — 여기서 확정)
- **Done when**:
  - [ ] viewport width < 768px OR Platform.isMobile 기준
  - [ ] window resize 반영

---

## M6. Cross-cutting

### T-601 — i18n (ko, en)
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-101
- **Outputs**: `src/i18n/index.ts`, `src/i18n/ko.ts`, `src/i18n/en.ts`
- **References**: PRD §8.8, LLD §10.3
- **Done when**:
  - [ ] `t(key)` 함수
  - [ ] ko/en이 동일 key 집합 (ts type으로 강제)
  - [ ] Obsidian moment.locale로 자동 감지
  - [ ] settings.locale로 override 가능

### T-602 — `SettingsPane.tsx`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-201, T-403
- **Outputs**: `src/ui/settings/SettingsPane.tsx`
- **References**: PRD §8.9, LLD §9.5
- **Done when**:
  - [ ] dataRootPath (read-only 표시)
  - [ ] saveDebounceMs (number input, 100~2000)
  - [ ] confirmOnDelete (toggle)
  - [ ] locale (auto/ko/en)
  - [ ] 변경 시 settingsRepo.save 호출

### T-603 — `DiagnosticsPane.tsx`
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-301, T-602
- **Outputs**: `src/ui/settings/DiagnosticsPane.tsx`
- **References**: PRD §8.7, LLD §9.5
- **Done when**:
  - [ ] store.diagnostics를 시간 역순으로 표시
  - [ ] kind별 아이콘/색상
  - [ ] path와 cause 표시

### T-604 — `TaskMasterSettingTab` 등록
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.15d
- **Dependencies**: T-602
- **Outputs**: `src/ui/settings/TaskMasterSettingTab.ts`, main.ts에 addSettingTab
- **References**: LLD §9.5
- **Done when**:
  - [ ] PluginSettingTab 상속, display/hide에서 React mount/unmount
  - [ ] Obsidian 설정 화면에 "TaskMaster" 탭 노출

### T-605 — a11y 검증
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-503, T-504
- **Outputs**: a11y QA checklist 결과 (`tests/manual/a11y.md`)
- **References**: PRD §10.6
- **Done when**:
  - [ ] Tab/Shift-Tab으로 모든 interactive element 도달
  - [ ] 키보드 단축키 4종 모두 동작
  - [ ] focus ring 시각적으로 명확
  - [ ] VoiceOver/NVDA로 카드 정보 읽기 검증
  - [ ] color blind 시뮬레이터로 status 인지 가능 확인

---

## M7. Polish & Validation

### T-701 — 1000개 task 성능 측정
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-401, T-501
- **Outputs**: `tests/perf/initial-render.md`, fixture script
- **References**: PRD §10.2, §12.2
- **Done when**:
  - [ ] 1000개 task fixture 생성 스크립트
  - [ ] 보드 초기 렌더링 ≤ 1초 (M1급 노트북)
  - [ ] card drag 60fps 유지 확인 (Chrome DevTools profiler)

### T-702 — 메모리 leak 검증 (50회 open/close)
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-402
- **Outputs**: `tests/manual/lifecycle.md`
- **References**: PRD §12.2
- **Done when**:
  - [ ] View 50회 open/close 반복
  - [ ] React DevTools에서 root 잔존 0
  - [ ] EventBus listener 잔존 0
  - [ ] heap snapshot에서 Detached DOM 미증가

### T-703 — 외부 modify 반영 검증
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-303
- **Outputs**: `tests/manual/external-modify.md`
- **References**: PRD §7.4
- **Done when**:
  - [ ] Obsidian editor에서 frontmatter status 변경 → 250ms 이내 보드 반영
  - [ ] 외부 텍스트 에디터로 변경 → metadataCache 갱신 후 반영
  - [ ] 파일 삭제 → 카드 사라짐
  - [ ] 파일 rename → entity 유지 (id 기준)

### T-704 — 두 leaf 동시 view 검증
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.15d
- **Dependencies**: T-501
- **Outputs**: 위 lifecycle.md에 추가
- **References**: PRD §7.1
- **Done when**:
  - [ ] 같은 view를 split으로 두 개 띄움
  - [ ] 한쪽에서 카드 이동 → 다른 쪽도 즉시 반영
  - [ ] 둘 다 닫아도 leak 없음

### T-705 — `.board.json` 삭제 후 reload 검증
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.15d
- **Dependencies**: T-303, T-208
- **Outputs**: 위 manual 문서에 추가
- **References**: PRD §12.2, ADR-0002
- **Done when**:
  - [ ] `.board.json` 삭제
  - [ ] Obsidian reload
  - [ ] 30초 이내 보드 재구성
  - [ ] 카드 위치가 PRD §9.4 알고리즘대로 정렬

### T-706 — 모바일 수동 QA (iOS/Android)
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.5d
- **Dependencies**: T-504
- **Outputs**: `tests/manual/mobile.md`
- **References**: PRD §10.5, ADR-0009
- **Done when**:
  - [ ] iOS Obsidian: status tab 전환, "다음 status" 버튼, archive/delete 동작
  - [ ] Android Obsidian: 위와 동일
  - [ ] 5회 view open/close 시 메모리 stable

### T-707 — 키보드만으로 보드 운영 검증
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.15d
- **Dependencies**: T-503, T-605
- **Outputs**: a11y.md에 추가
- **References**: PRD §7.9
- **Done when**:
  - [ ] 마우스 미사용으로 카드 생성, 이동, 순서 변경, archive, delete 모두 가능

### T-708 — Dataview 호환 (passthrough) 검증
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.15d
- **Dependencies**: T-205
- **Outputs**: `tests/manual/passthrough.md`
- **References**: ADR-0008
- **Done when**:
  - [ ] task 파일에 `tags`, `aliases`, Dataview 쿼리용 field 추가
  - [ ] TaskMaster에서 status 변경 후 위 field가 모두 보존됨
  - [ ] Dataview 플러그인 쿼리가 우리 task를 인식

---

## M8. Release Prep

### T-801 — README.md
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: M0~M7 done
- **Outputs**: `README.md`
- **References**: PRD §15
- **Done when**:
  - [ ] 한 문단 소개, 스크린샷, 설치 방법 (manual + BRAT), 기본 사용법, 데이터 위치, FAQ

### T-802 — CHANGELOG.md (Keep a Changelog)
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.1d
- **Dependencies**: (none)
- **Outputs**: `CHANGELOG.md`
- **References**: PRD §15
- **Done when**:
  - [ ] `## [0.1.0] - YYYY-MM-DD` 섹션, Added/Changed/Fixed 분류

### T-803 — BRAT 호환 검증
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.25d
- **Dependencies**: T-005, T-001
- **Outputs**: BRAT 설치 가이드 (README에 포함)
- **References**: PRD §15
- **Done when**:
  - [ ] BRAT으로 GitHub repo 등록 → 정상 install
  - [ ] manifest.json, main.js, styles.css가 release artifact에 포함

### T-804 — GitHub Release 자동화 script (선택적)
- **Status**: ⏭ skipped (Phase 1 manual release; automation은 추후)
- **Estimate**: 0.15d
- **Dependencies**: T-005
- **Outputs**: `.github/workflows/release.yml` (optional)
- **References**: PRD §15
- **Done when**:
  - [ ] tag push 시 dist/* 자동 release artifact 첨부
  - [ ] (Phase 1에 부담이면 manual release로 대체)

### T-805 — Milestone 1 완료 정의 checklist
- **Status**: ✅ done (2026-05-10)
- **Estimate**: 0.1d
- **Dependencies**: 모든 task done
- **Outputs**: `tests/manual/milestone-1-checklist.md`
- **References**: PRD §17
- **Done when**:
  - [ ] PRD §17의 14개 항목 모두 체크
  - [ ] 모든 unit test 통과
  - [ ] 모든 manual QA 통과
  - [ ] 0.1.0 GitHub release 게시

---

## 4. 진행 추적

각 task의 Status는 이 파일에서 직접 갱신한다. PR 단위와 task 단위가 일치하는 게 이상적 (1 task = 1 PR).

PR title 형식: `T-XXX: <task title>`.

PR description에 "Done when" 체크박스를 그대로 복사해 진행 상황을 검증한다.

## 5. 다음 단계

Phase 1이 완료되면 다음을 검토한다.

1. Phase 1 사용 피드백 수집 (1~2주).
2. PRD §16 오픈 이슈 중 어떤 것을 Phase 2로 끌어올릴지 결정.
3. Phase 2 실행 계획은 `planning/TASKS2.md`에서 추적한다.

Phase 1 진행 중에 발견되는 새 task는 같은 milestone 끝에 T-XYZ 형식으로 번호를 이어 추가한다.
