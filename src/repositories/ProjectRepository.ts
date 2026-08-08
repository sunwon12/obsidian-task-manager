// LLD §5.4: ProjectRepository.
// 가장 단순. Phase 1은 findAll, create만 (update/delete UI 없음).

import { TFile, TFolder, normalizePath, type App } from "obsidian";
import type { DiagnosticsLog } from "../core/diagnostics";
import { ulidOf } from "../core/ids";
import { joinPath, safeTitle } from "../core/paths";
import { parseProject, serializeProject } from "../parser/projectMarkdown";
import type { Project, ProjectId } from "../core/types";

const SHORT_ID_RE = /(project_[0-9A-HJKMNP-TV-Z]+)\.md$/;

export class ProjectRepository {
  private readonly pathById = new Map<ProjectId, string>();
  private readonly shortIds = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly diagnostics: DiagnosticsLog,
    private readonly projectsFolder: string,
  ) {}

  async findAll(): Promise<Project[]> {
    this.shortIds.clear();
    this.pathById.clear();

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(this.projectsFolder + "/"));

    const projects: Project[] = [];
    for (const file of files) {
      // TaskRepository.findAll과 동일: 캐시 미존재 파일을 skip하면 외부 생성
      // 파일이 세션 내내 유실된다. 캐시가 있을 때만 사전필터로 쓴다.
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && fm["type"] !== "project") continue;

      try {
        const raw = await this.app.vault.cachedRead(file);
        const parsed = parseProject(raw);
        if (!parsed) {
          this.diagnostics.record({
            kind: "parse",
            path: file.path,
            message: "schema validation failed",
          });
          continue;
        }
        const p: Project = {
          ...parsed.project,
          knownMtime: file.stat.mtime,
          path: file.path,
        };
        projects.push(p);
        this.pathById.set(p.id, file.path);
        const short = this.shortIdOfPath(file.path);
        if (short) this.shortIds.add(short);
      } catch (err) {
        this.diagnostics.record({
          kind: "parse",
          path: file.path,
          message: "parse error",
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return projects;
  }

  async create(project: Project, body = ""): Promise<Project> {
    await this.ensureFolderExists(this.projectsFolder);
    const path = await this.allocatePath(project);
    const draft: Project = { ...project, path, knownMtime: 0 };
    await this.app.vault.create(path, serializeProject(draft, body));

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`create failed: ${path}`);

    const persisted: Project = { ...project, path, knownMtime: file.stat.mtime };
    this.pathById.set(project.id, path);
    const short = this.shortIdOfPath(path);
    if (short) this.shortIds.add(short);
    return persisted;
  }

  getKnownPath(id: ProjectId): string | undefined {
    return this.pathById.get(id);
  }

  async readWithBody(id: ProjectId): Promise<{ project: Project; body: string }> {
    const file = this.fileOf(id);
    const raw = await this.app.vault.read(file);
    const parsed = parseProject(raw);
    if (!parsed) {
      this.diagnostics.record({
        kind: "parse",
        path: file.path,
        entityId: id,
        message: "project schema validation failed",
      });
      throw new Error(`Invalid project file: ${file.path}`);
    }
    return {
      project: {
        ...parsed.project,
        knownMtime: file.stat.mtime,
        path: file.path,
      },
      body: parsed.body,
    };
  }

  async saveImmediate(project: Project, body: string): Promise<Project> {
    const file = this.fileOf(project.id);
    const currentRaw = await this.app.vault.read(file);
    if (file.stat.mtime > project.knownMtime) {
      await this.writeConflictedCopy(project, body);
      this.diagnostics.record({
        kind: "conflict",
        entityId: project.id,
        path: file.path,
        message: "project external change detected; wrote conflicted copy",
      });
      const current = parseProject(currentRaw);
      if (current) {
        return {
          ...current.project,
          knownMtime: file.stat.mtime,
          path: file.path,
        };
      }
      return {
        ...project,
        knownMtime: file.stat.mtime,
        path: file.path,
      };
    }
    await this.app.vault.modify(file, serializeProject(project, body));
    const persisted: Project = {
      ...project,
      knownMtime: file.stat.mtime,
      path: file.path,
    };
    this.pathById.set(project.id, file.path);
    return persisted;
  }

  async createStandaloneMemoNote(
    title: string,
    body: string,
    blockId: string,
  ): Promise<string> {
    const folder = this.memoNotesFolder();
    await this.ensureFolderExists(folder);
    const safe = safeTitle(title || "memo");
    const idPart = blockId.replace(/^tm-memo-/u, "");
    for (let len = 8; len <= Math.max(8, idPart.length); len++) {
      const path = normalizePath(joinPath(folder, `${safe} - memo_${idPart.slice(0, len)}.md`));
      if (this.app.vault.getAbstractFileByPath(path)) continue;
      await this.app.vault.create(path, body);
      return path;
    }
    throw new Error(`memo note path allocation exhausted for ${blockId}`);
  }

  private async writeConflictedCopy(project: Project, body: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
    const conflictPath = project.path.replace(/\.md$/, ` - conflict ${stamp}.md`);
    await this.app.vault.create(
      conflictPath,
      serializeProject({ ...project, path: conflictPath }, body),
    );
  }

  private async allocatePath(p: Project): Promise<string> {
    const safe = safeTitle(p.title || "untitled");
    const ulidPart = ulidOf(p.id);
    for (let len = 8; len <= 26; len++) {
      const short = `project_${ulidPart.slice(0, len)}`;
      if (this.shortIds.has(short)) continue;
      const path = normalizePath(joinPath(this.projectsFolder, `${safe} - ${short}.md`));
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
    }
    throw new Error(`path allocation exhausted for ${p.id}`);
  }

  private fileOf(id: ProjectId): TFile {
    const path = this.pathById.get(id);
    if (!path) throw new Error(`Unknown project id: ${id}`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Project file missing: ${path}`);
    return file;
  }

  private shortIdOfPath(path: string): string {
    const m = path.match(SHORT_ID_RE);
    return m && m[1] ? m[1] : "";
  }

  private memoNotesFolder(): string {
    const idx = this.projectsFolder.lastIndexOf("/");
    const root = idx >= 0 ? this.projectsFolder.slice(0, idx) : this.projectsFolder;
    return normalizePath(joinPath(root, "ProjectMemos"));
  }

  private async ensureFolderExists(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    if (existing) return;
    await this.app.vault.createFolder(path);
  }
}
