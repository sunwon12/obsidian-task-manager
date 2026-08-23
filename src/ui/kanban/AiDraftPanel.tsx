import * as React from "react";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import { inspectPlan, type AiDraftSuggestion } from "../../core/aiDraft";
import type { Priority, ProjectId, Task } from "../../core/types";

/** 모달 폼이 들고 있는 현재 값 — "이미 값이 있는가" 판정에 쓴다. */
export interface DraftFormValues {
  priority: Priority | "none";
  project: ProjectId | "none";
  tags: string;
  remarks: string;
  steps: string[];
}

export type DraftPatch = Partial<{
  priority: Priority | "none";
  project: ProjectId | "none";
  tags: string;
  remarks: string;
  steps: string[];
}>;

interface Props {
  task: Task;
  values: DraftFormValues;
  onApply: (patch: DraftPatch) => void;
}

type FieldKey = "priority" | "project" | "tags" | "remarks" | "steps";

interface Proposal {
  key: FieldKey;
  label: string;
  /** 사람이 읽을 제안 값. */
  preview: string;
  /** 이미 값이 있으면 기본 해제한다 (ADR-0012 §2). */
  hadValue: boolean;
  apply: () => DraftPatch;
}

type MessageKey = Parameters<typeof t>[0];

const PRIORITY_LABELS: Record<Priority, MessageKey> = {
  low: "modal.task.priorityLow",
  medium: "modal.task.priorityMedium",
  high: "modal.task.priorityHigh",
};

/**
 * AI 초안 섹션. 제안을 필드별로 고르게 하고, 고른 것만 폼에 얹는다.
 * 저장은 기존 저장 버튼이 하므로 여기서 디스크를 건드리지 않는다.
 */
export const AiDraftPanel: React.FC<Props> = ({ task, values, onApply }) => {
  const { aiDraftService } = useServices();
  const projects = useStore((s) => s.projects);
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
  const [selected, setSelected] = React.useState<Set<FieldKey>>(new Set());
  const [applied, setApplied] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!aiDraftService) return;
    aiDraftService.reset();
    return aiDraftService.subscribe(forceRender);
  }, [aiDraftService, task.id]);

  const state = aiDraftService?.getState() ?? null;
  const running = state?.status === "running";

  React.useEffect(() => {
    if (!running || state?.startedAt == null) {
      setElapsed(0);
      return;
    }
    const startedAt = state.startedAt;
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, state?.startedAt]);

  const suggestion = state?.suggestion ?? null;

  const proposals = React.useMemo(
    () => (suggestion ? buildProposals(suggestion, values, projects) : []),
    [suggestion, values, projects],
  );

  // 새 제안이 오면 "비어 있던 필드"만 미리 골라 둔다.
  React.useEffect(() => {
    setApplied(false);
    setSelected(new Set(proposals.filter((p) => !p.hadValue).map((p) => p.key)));
    // 의존은 suggestion 하나다 — proposals는 폼 값이 바뀔 때마다 새로 만들어지므로
    // 여기에 넣으면 사용자가 방금 고른 체크가 편집할 때마다 풀린다.
  }, [suggestion]);

  if (!aiDraftService?.isSupported()) {
    return (
      <p className="tm-mt-3 tm-text-xs tm-text-tm-muted">{t("aiDraft.unsupported")}</p>
    );
  }

  function run(deep: boolean): void {
    void aiDraftService?.suggest({
      title: task.title,
      body: task.bodySummary ?? "",
      jiraKey: task.jiraKey,
      existingSteps: values.steps.filter((step) => step.trim().length > 0),
      existingTags: parseTagList(values.tags),
      existingRemarks: values.remarks.trim() || null,
      projectTitles: [...projects.values()].map((project) => project.title),
      deep,
    });
  }

  function toggle(key: FieldKey): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applySelected(): void {
    const patch = proposals
      .filter((proposal) => selected.has(proposal.key))
      .reduce<DraftPatch>((acc, proposal) => ({ ...acc, ...proposal.apply() }), {});
    if (Object.keys(patch).length === 0) return;
    onApply(patch);
    setApplied(true);
  }

  const warnings = suggestion
    ? inspectPlan(suggestion.steps.length > 0 ? suggestion.steps : values.steps)
    : [];

  return (
    <section className="tm-mt-4 tm-rounded tm-border tm-border-tm-border tm-p-3">
      <div className="tm-flex tm-items-center tm-justify-between tm-gap-2">
        <h4 className="tm-m-0 tm-text-sm tm-font-medium">{t("aiDraft.title")}</h4>
        <div className="tm-flex tm-gap-1">
          <button
            type="button"
            disabled={running}
            onClick={() => run(false)}
            title={t("aiDraft.fastHint")}
            className="tm-rounded tm-px-2 tm-py-1 tm-text-xs tm-text-tm-accent hover:tm-bg-tm-bg-hover disabled:tm-opacity-50"
          >
            {t("aiDraft.fast")}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => run(true)}
            title={t("aiDraft.deepHint")}
            className="tm-rounded tm-px-2 tm-py-1 tm-text-xs tm-text-tm-accent hover:tm-bg-tm-bg-hover disabled:tm-opacity-50"
          >
            {t("aiDraft.deep")}
          </button>
        </div>
      </div>

      {running && (
        <p className="tm-mt-2 tm-text-xs tm-text-tm-muted">
          {t("aiDraft.running").replace("{seconds}", String(elapsed))}
        </p>
      )}

      {state?.error && !running && (
        <p className="tm-mt-2 tm-text-xs tm-text-tm-error">{state.error}</p>
      )}

      {suggestion && !running && (
        <>
          {proposals.length === 0 && state?.mode === "generate" && (
            <p className="tm-mt-2 tm-text-xs tm-text-tm-muted">{t("aiDraft.empty")}</p>
          )}

          {proposals.length > 0 && (
            <ul className="tm-mt-2 tm-list-none tm-p-0 tm-flex tm-flex-col tm-gap-2">
              {proposals.map((proposal) => (
                <li key={proposal.key} className="tm-flex tm-items-start tm-gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(proposal.key)}
                    onChange={() => toggle(proposal.key)}
                    className="tm-mt-1"
                    aria-label={proposal.label}
                  />
                  <div className="tm-min-w-0">
                    <div className="tm-text-xs tm-text-tm-muted">
                      {proposal.label}
                      {proposal.hadValue && ` · ${t("aiDraft.hasValue")}`}
                    </div>
                    <div className="tm-whitespace-pre-wrap tm-break-words tm-text-sm">{proposal.preview}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {state?.mode === "critique" && suggestion.critique.length > 0 && (
            <div className="tm-mt-3">
              <div className="tm-text-xs tm-text-tm-muted">{t("aiDraft.critiqueTitle")}</div>
              <ul className="tm-mt-1 tm-pl-4 tm-text-sm">
                {suggestion.critique.map((line, index) => (
                  <li key={`${index}-${line.slice(0, 12)}`}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="tm-mt-3">
              <div className="tm-text-xs tm-text-tm-muted">{t("aiDraft.warnings")}</div>
              <ul className="tm-mt-1 tm-pl-4 tm-text-xs tm-text-tm-muted">
                {warnings.map((warning) => (
                  <li key={warning.code}>{warning.message}</li>
                ))}
              </ul>
            </div>
          )}

          {suggestion.rationale && (
            <p className="tm-mt-3 tm-text-xs tm-text-tm-muted">
              {t("aiDraft.rationale")} — {suggestion.rationale}
            </p>
          )}

          {proposals.length > 0 && (
            <div className="tm-mt-3 tm-flex tm-items-center tm-gap-2">
              <button
                type="button"
                onClick={applySelected}
                disabled={selected.size === 0}
                className="tm-rounded tm-bg-tm-accent tm-px-2 tm-py-1 tm-text-xs tm-text-white disabled:tm-opacity-50"
              >
                {t("aiDraft.apply")}
              </button>
              {applied && <span className="tm-text-xs tm-text-tm-muted">{t("aiDraft.applied")}</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
};

function buildProposals(
  suggestion: AiDraftSuggestion,
  values: DraftFormValues,
  projects: ReadonlyMap<ProjectId, { title: string }>,
): Proposal[] {
  const proposals: Proposal[] = [];

  if (suggestion.priority && suggestion.priority !== values.priority) {
    const priority = suggestion.priority;
    proposals.push({
      key: "priority",
      label: t("aiDraft.field.priority"),
      preview: t(PRIORITY_LABELS[priority]),
      hadValue: values.priority !== "none",
      apply: () => ({ priority }),
    });
  }

  if (suggestion.projectTitle) {
    const match = [...projects.entries()].find(
      ([, project]) => project.title.trim() === suggestion.projectTitle?.trim(),
    );
    if (match && match[0] !== values.project) {
      const projectId = match[0];
      proposals.push({
        key: "project",
        label: t("aiDraft.field.project"),
        preview: match[1].title,
        hadValue: values.project !== "none",
        apply: () => ({ project: projectId }),
      });
    }
  }

  const currentTags = parseTagList(values.tags);
  const mergedTags = [...currentTags];
  for (const tag of suggestion.tags) {
    if (!mergedTags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) mergedTags.push(tag);
  }
  if (mergedTags.length > currentTags.length) {
    proposals.push({
      key: "tags",
      label: t("aiDraft.field.tags"),
      preview: mergedTags.join(", "),
      hadValue: currentTags.length > 0,
      apply: () => ({ tags: mergedTags.join(", ") }),
    });
  }

  if (suggestion.remarks && suggestion.remarks !== values.remarks.trim()) {
    const remarks = suggestion.remarks;
    proposals.push({
      key: "remarks",
      label: t("aiDraft.field.remarks"),
      preview: remarks,
      hadValue: values.remarks.trim().length > 0,
      apply: () => ({ remarks }),
    });
  }

  // 비평 모드에서는 steps가 비어 오므로 여기 걸리지 않는다 — 덮어쓰기 경로 자체가 없다.
  if (suggestion.steps.length > 0) {
    const steps = [...suggestion.steps];
    proposals.push({
      key: "steps",
      label: t("aiDraft.field.steps"),
      preview: steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      hadValue: values.steps.some((step) => step.trim().length > 0),
      apply: () => ({ steps }),
    });
  }

  return proposals;
}

function parseTagList(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}
