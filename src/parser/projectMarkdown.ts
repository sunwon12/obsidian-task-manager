// LLD §4.2: Project Markdown 파서. 가장 단순.
import { parseFile, serializeFile } from "./frontmatter";
import { isValidId } from "../core/ids";
import { nowIso } from "../core/time";
import { SCHEMA_VERSION } from "../core/types";
import type {
  Project, ProjectFrontmatterDoc, ProjectId, IsoDateTime,
} from "../core/types";

export interface ParsedProject {
  project: Omit<Project, "knownMtime" | "path">;
  body: string;
}

export function parseProject(raw: string): ParsedProject | null {
  const { fm, body } = parseFile(raw, "project");
  const m = fm.managed;

  if (m["type"] !== "project") return null;
  if (!isValidId("project", m["id"])) return null;

  const title = extractTitle(body) || "Untitled";

  return {
    project: {
      schemaVersion: SCHEMA_VERSION,
      id: m["id"] as ProjectId,
      type: "project",
      title,
      createdAt: typeof m["createdAt"] === "string"
        ? (m["createdAt"] as IsoDateTime)
        : nowIso(),
      updatedAt: typeof m["updatedAt"] === "string"
        ? (m["updatedAt"] as IsoDateTime)
        : nowIso(),
      passthrough: fm.passthrough,
      fieldOrder: fm.fieldOrder,
    },
    body,
  };
}

export function serializeProject(project: Project, body: string): string {
  const doc: ProjectFrontmatterDoc = {
    schemaVersion: project.schemaVersion,
    id: project.id,
    type: "project",
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  return serializeFile(
    {
      managed: doc as unknown as Record<string, unknown>,
      passthrough: project.passthrough,
      fieldOrder: project.fieldOrder,
    },
    ensureHeading(body, project.title),
  );
}

function extractTitle(body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m && m[1] ? m[1].trim() : "";
}

function ensureHeading(body: string, title: string): string {
  if (/^#\s+.+$/m.test(body)) {
    return body.replace(/^#\s+.+$/m, `# ${title}`);
  }
  const trimmed = body.replace(/^\n+/, "");
  return `# ${title}\n\n${trimmed}`;
}
