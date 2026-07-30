import * as React from "react";
import { Notice } from "obsidian";
import { useServices } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { ProjectId } from "../../core/types";
import type { ProjectMemoBlock } from "../../services/ProjectMemoService";
import { wikiLinkToPath } from "../../core/wikiLink";

type ActionState = "idle" | "creating" | "created" | "error";
type CopyState = "idle" | "copied";

export const ProjectMemoActions: React.FC<{
  projectId: ProjectId;
  memo: ProjectMemoBlock;
}> = ({ projectId, memo }) => {
  const services = useServices();
  const [taskState, setTaskState] = React.useState<ActionState>("idle");
  const [noteState, setNoteState] = React.useState<ActionState>("idle");
  const [copyState, setCopyState] = React.useState<CopyState>("idle");

  async function createTask(): Promise<void> {
    if (taskState === "creating") return;
    setTaskState("creating");
    try {
      const projectPath = services.projectService.getProjectPath(projectId);
      const task = await services.taskService.createTask({
        title: taskTitleFromMemo(memo.text),
        project: projectId,
        body: taskBodyFromMemo(memo, projectPath),
      });
      await services.projectMemoService.linkMemoToTask(projectId, memo.id, task.path);
      setTaskState("created");
    } catch {
      setTaskState("error");
    }
  }

  async function promoteToNote(): Promise<void> {
    if (noteState === "creating") return;
    setNoteState("creating");
    try {
      await services.projectMemoService.promoteMemoToNote(projectId, memo.id);
      setNoteState("created");
    } catch {
      setNoteState("error");
    }
  }

  async function copyLink(): Promise<void> {
    try {
      const projectPath = services.projectService.getProjectPath(projectId);
      await navigator.clipboard.writeText(memoLinkFromPath(memo, projectPath));
      setCopyState("copied");
    } catch {
      new Notice(t("projectMemo.linkCopyFailed"));
    }
  }

  return (
    <div className="tm-flex tm-flex-wrap tm-items-center tm-gap-1">
      <button
        type="button"
        onClick={() => void createTask()}
        disabled={taskState === "creating"}
        className="tm-rounded tm-border tm-border-tm-border tm-px-2 tm-py-1 tm-text-xs tm-text-tm-text hover:tm-bg-tm-bg-hover disabled:tm-opacity-50"
      >
        {taskState === "created"
          ? t("projectMemo.taskCreated")
          : taskState === "error"
            ? t("projectMemo.taskCreateFailed")
            : t("projectMemo.createTask")}
      </button>
      <button
        type="button"
        onClick={() => void promoteToNote()}
        disabled={noteState === "creating"}
        className="tm-rounded tm-border tm-border-tm-border tm-px-2 tm-py-1 tm-text-xs tm-text-tm-text hover:tm-bg-tm-bg-hover disabled:tm-opacity-50"
      >
        {noteState === "created"
          ? t("projectMemo.notePromoted")
          : noteState === "error"
            ? t("projectMemo.notePromoteFailed")
          : t("projectMemo.promoteNote")}
      </button>
      <button
        type="button"
        onClick={() => void copyLink()}
        className="tm-rounded tm-border tm-border-tm-border tm-px-2 tm-py-1 tm-text-xs tm-text-tm-text hover:tm-bg-tm-bg-hover"
      >
        {copyState === "copied"
          ? t("projectMemo.linkCopied")
          : t("projectMemo.copyLink")}
      </button>
    </div>
  );
};

function taskTitleFromMemo(text: string): string {
  const firstLine = text.split(/\r?\n/u)[0]?.trim() ?? "";
  return firstLine.slice(0, 80) || "Untitled";
}

function taskBodyFromMemo(memo: ProjectMemoBlock, projectPath: string | null): string {
  const link = memoLinkFromPath(memo, projectPath);
  return [
    `Source memo: ${link}`,
    "",
    memo.text,
  ].join("\n");
}

function memoLinkFromPath(memo: ProjectMemoBlock, projectPath: string | null): string {
  return projectPath
    ? wikiLinkToPath(projectPath, memo.id)
    : `^${memo.id}`;
}

export const __test_taskTitleFromMemo = taskTitleFromMemo;
export const __test_taskBodyFromMemo = taskBodyFromMemo;
export const __test_memoLinkFromPath = memoLinkFromPath;
