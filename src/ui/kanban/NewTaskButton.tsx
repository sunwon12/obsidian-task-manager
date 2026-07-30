import * as React from "react";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { NewTaskModal } from "./NewTaskModal";
import { t } from "../../i18n";
import type { CreateTaskInput, Priority, ProjectId, TaskStatus } from "../../core/types";
import type { ProjectFilter } from "../../store/taskMasterStore";

export const NewTaskButton: React.FC = () => {
  const services = useServices();
  const projectFilter = useStore((s) => s.selectedProjectId);
  const [open, setOpen] = React.useState(false);

  // 현재 project filter가 특정 project이면 새 task의 default project로 사용.
  const defaultProject = isProjectId(projectFilter) ? projectFilter : null;

  async function handleCreate(input: {
    title: string;
    status: TaskStatus;
    priority: Priority | null;
    jiraKey: string | null;
    remarks: string | null;
  }): Promise<void> {
    const payload: CreateTaskInput = {
      title: input.title,
      status: input.status,
      priority: input.priority,
      jiraKey: input.jiraKey,
      remarks: input.remarks,
      project: defaultProject,
    };
    await services.taskService.createTask(payload);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tm-px-3 tm-py-1.5 tm-text-sm tm-bg-tm-accent tm-text-white tm-rounded hover:tm-opacity-90"
      >
        {t("header.newTask")}
      </button>
      {open && (
        <NewTaskModal onClose={() => setOpen(false)} onCreate={handleCreate} />
      )}
    </>
  );
};

function isProjectId(v: ProjectFilter): v is ProjectId {
  return v !== "all" && v !== "none";
}
