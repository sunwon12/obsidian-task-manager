import * as React from "react";
import { TFile } from "obsidian";
import { useServices } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { IsoDate, Project } from "../../core/types";
import { wikiLinkToPath } from "../../core/wikiLink";

export const NewMeetingButton: React.FC<{ project: Project }> = ({ project }) => {
  const services = useServices();

  async function handleCreate(): Promise<void> {
    const date = localDate(new Date()) as IsoDate;
    const projectPath = services.projectService.getProjectPath(project.id);
    const projectLink = projectPath ? wikiLinkToPath(projectPath) : project.title;
    const meeting = await services.meetingService.createMeeting({
      title: `${project.title} ${date} Meeting`,
      date,
      project: project.id,
      body: [
        `Project: ${projectLink}`,
        "",
        "## Agenda",
        "",
        "## Notes",
        "",
        "## Action Items",
        "",
      ].join("\n"),
    });
    const file = services.app.vault.getAbstractFileByPath(meeting.path);
    if (file instanceof TFile) {
      await services.app.workspace.getLeaf("tab").openFile(file);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCreate()}
      className="tm-px-3 tm-py-1.5 tm-text-sm tm-border tm-border-tm-border tm-rounded hover:tm-bg-tm-bg-hover"
    >
      {t("header.newMeeting")}
    </button>
  );
};

function localDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
