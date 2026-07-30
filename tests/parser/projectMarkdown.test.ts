import { describe, it, expect } from "vitest";
import { parseProject, serializeProject } from "../../src/parser/projectMarkdown";
import type { Project, ProjectId, IsoDateTime } from "../../src/core/types";
import { SCHEMA_VERSION } from "../../src/core/types";

const validId = "project_01HX9C5K3D8GHX0Y7T2QN8VFE2";

const baseRaw = `---
schemaVersion: 1
id: ${validId}
type: project
createdAt: 2026-05-08T10:00:00.000Z
updatedAt: 2026-05-08T10:00:00.000Z
---

# 웹사이트 리뉴얼

프로젝트 설명
`;

describe("parseProject", () => {
  it("parses a valid project", () => {
    const result = parseProject(baseRaw);
    expect(result).not.toBeNull();
    expect(result!.project.id).toBe(validId);
    expect(result!.project.title).toBe("웹사이트 리뉴얼");
  });

  it("rejects invalid id prefix", () => {
    const raw = baseRaw.replace(validId, "task_01HX9C5K3D8GHX0Y7T2QN8VFE2");
    expect(parseProject(raw)).toBeNull();
  });
});

describe("serializeProject", () => {
  it("round-trips a project", () => {
    const project: Project = {
      schemaVersion: SCHEMA_VERSION,
      id: validId as ProjectId,
      type: "project",
      title: "웹사이트 리뉴얼",
      createdAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
      updatedAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
      passthrough: {},
      fieldOrder: ["schemaVersion", "id", "type", "createdAt", "updatedAt"],
      knownMtime: 0,
      path: "TaskMaster/Projects/x.md",
    };
    const out = serializeProject(project, "프로젝트 설명\n");
    const reparsed = parseProject(out);
    expect(reparsed?.project.id).toBe(project.id);
    expect(reparsed?.project.title).toBe(project.title);
  });
});
