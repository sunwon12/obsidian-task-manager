// LLD §9.5: Plugin SettingTab 안에 mount되는 React component.

import * as React from "react";
import { useServices } from "../../app/providers/TaskMasterProvider";
import { DiagnosticsPane } from "./DiagnosticsPane";
import { t } from "../../i18n";
import type { PluginSettings } from "../../core/types";

export const SettingsPane: React.FC = () => {
  const services = useServices();
  // settings는 saveSettings로 갱신되지만, settings 객체 자체는 container에 cached.
  // 변경 즉시 UI에 반영되도록 local state로 mirror.
  const [settings, setSettings] = React.useState<PluginSettings>(services.settings);

  async function update(patch: Partial<PluginSettings>): Promise<void> {
    const next = { ...settings, ...patch };
    setSettings(next);
    await services.saveSettings(next);
  }

  return (
    <div className="tm-flex tm-flex-col tm-gap-6 tm-p-4">
      <Field
        title={t("settings.dataRoot.title")}
        description={t("settings.dataRoot.desc")}
      >
        <input
          type="text"
          value={settings.dataRootPath}
          disabled
          className="tm-w-full tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-text-tm-muted tm-rounded"
        />
      </Field>

      <Field
        title={t("settings.debounce.title")}
        description={`${t("settings.debounce.desc")} ${t("settings.requiresReload")}`}
      >
        <input
          type="number"
          min={100}
          max={2000}
          value={settings.saveDebounceMs}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 100 && v <= 2000) {
              void update({ saveDebounceMs: v });
            }
          }}
          className="tm-w-32 tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded"
        />
      </Field>

      <Field
        title={t("settings.confirmOnDelete.title")}
        description={t("settings.confirmOnDelete.desc")}
      >
        <label className="tm-inline-flex tm-items-center tm-gap-2">
          <input
            type="checkbox"
            checked={settings.confirmOnDelete}
            onChange={(e) => void update({ confirmOnDelete: e.target.checked })}
          />
        </label>
      </Field>

      <Field
        title={t("settings.jiraBaseUrl.title")}
        description={t("settings.jiraBaseUrl.desc")}
      >
        <input
          type="url"
          value={settings.jiraBaseUrl}
          placeholder="https://jira.example.com/browse/"
          onChange={(e) => void update({ jiraBaseUrl: e.target.value })}
          className="tm-w-80 tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded tm-text-tm-text"
        />
      </Field>

      <Field
        title={t("settings.locale.title")}
        description={`${t("settings.locale.desc")} ${t("settings.requiresReload")}`}
      >
        <select
          value={settings.locale}
          onChange={(e) => void update({ locale: e.target.value as PluginSettings["locale"] })}
          className="tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded"
        >
          <option value="auto">{t("settings.locale.auto")}</option>
          <option value="ko">{t("settings.locale.ko")}</option>
          <option value="en">{t("settings.locale.en")}</option>
        </select>
      </Field>

      <div>
        <h3 className="tm-text-base tm-font-medium tm-mb-2">
          {t("settings.diagnostics.title")}
        </h3>
        <DiagnosticsPane />
      </div>
    </div>
  );
};

const Field: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <div className="tm-flex tm-items-start tm-justify-between tm-gap-4">
    <div className="tm-flex-1">
      <div className="tm-font-medium tm-text-tm-text">{title}</div>
      <div className="tm-text-sm tm-text-tm-muted tm-mt-0.5">{description}</div>
    </div>
    <div className="tm-shrink-0">{children}</div>
  </div>
);
