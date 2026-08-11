import * as React from "react";
import { t } from "../../i18n";

interface Props {
  steps: string[];
  onChange: (steps: string[]) => void;
}

/** Task 생성·편집에서 작업 계획을 번호별 개별 입력으로 받는 편집기. */
export const WorkPlanEditor: React.FC<Props> = ({ steps, onChange }) => {
  const baseId = React.useId();
  const rows = steps.length > 0 ? steps : [""];

  function update(index: number, value: string): void {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  }

  function remove(index: number): void {
    const next = rows.filter((_, rowIndex) => rowIndex !== index);
    onChange(next.length > 0 ? next : [""]);
  }

  return (
    <fieldset className="tm-m-0 tm-mt-3 tm-border-0 tm-p-0">
      <legend className="tm-mb-1 tm-text-sm">{t("modal.task.steps")}</legend>
      <div className="tm-flex tm-flex-col tm-gap-2">
        {rows.map((step, index) => {
          const inputId = `${baseId}-${index}`;
          return (
            <div key={inputId} className="tm-flex tm-items-center tm-gap-2">
              <label htmlFor={inputId} className="tm-w-12 tm-shrink-0 tm-text-xs tm-text-tm-muted">
                {t("modal.task.stepNumber").replace("{number}", String(index + 1))}
              </label>
              <input
                id={inputId}
                type="text"
                value={step}
                onChange={(event) => update(index, event.target.value)}
                placeholder={t("modal.task.stepPlaceholder")}
                className="tm-min-w-0 tm-flex-1 tm-px-3 tm-py-2 tm-bg-tm-bg-alt tm-border tm-border-tm-border tm-rounded tm-text-tm-text"
              />
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={t("modal.task.removeStep").replace("{number}", String(index + 1))}
                title={t("modal.task.removeStep").replace("{number}", String(index + 1))}
                className="tm-h-8 tm-w-8 tm-shrink-0 tm-rounded tm-text-tm-muted hover:tm-bg-tm-bg-hover hover:tm-text-tm-text"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, ""])}
        className="tm-mt-2 tm-rounded tm-px-2 tm-py-1 tm-text-xs tm-text-tm-accent hover:tm-bg-tm-bg-hover"
      >
        {t("modal.task.addStep")}
      </button>
    </fieldset>
  );
};

export function normalizePlanSteps(steps: readonly string[]): string[] {
  return steps.map((step) => step.trim()).filter(Boolean);
}
