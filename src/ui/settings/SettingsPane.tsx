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
  const [syncing, setSyncing] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);

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

      <div className="tm-border-t tm-border-tm-border tm-pt-5">
        <h3 className="tm-text-base tm-font-medium tm-mb-3">{t("settings.jiraSync.title")}</h3>
        <div className="tm-flex tm-flex-col tm-gap-4">
          <Field title={t("settings.jiraApiUrl.title")} description={t("settings.jiraApiUrl.desc")}>
            <input type="url" value={settings.jiraApiUrl} placeholder="https://jira.example.com"
              onChange={(e) => void update({ jiraApiUrl: e.target.value })}
              className="tm-w-80 tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded tm-text-tm-text" />
          </Field>
          <Field title={t("settings.jiraAuth.title")} description={t("settings.jiraAuth.desc")}>
            <select value={settings.jiraAuthType} onChange={(e) => void update({ jiraAuthType: e.target.value as PluginSettings["jiraAuthType"] })}
              className="tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded">
              <option value="bearer">Bearer token</option><option value="basic">Email + API token</option>
            </select>
          </Field>
          {settings.jiraAuthType === "basic" && (
            <Field title={t("settings.jiraEmail.title")} description={t("settings.jiraEmail.desc")}>
              <input type="email" value={settings.jiraEmail} onChange={(e) => void update({ jiraEmail: e.target.value })}
                className="tm-w-80 tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded tm-text-tm-text" />
            </Field>
          )}
          <Field title={t("settings.jiraToken.title")} description={t("settings.jiraToken.desc")}>
            <input type="password" value={settings.jiraApiToken} onChange={(e) => void update({ jiraApiToken: e.target.value })}
              className="tm-w-80 tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded tm-text-tm-text" />
          </Field>
          <Field title={t("settings.jiraJql.title")} description={t("settings.jiraJql.desc")}>
            <input type="text" value={settings.jiraJql} onChange={(e) => void update({ jiraJql: e.target.value })}
              className="tm-w-[32rem] tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded tm-text-tm-text" />
          </Field>
          <Field title={t("settings.jiraInterval.title")} description={t("settings.jiraInterval.desc")}>
            <input type="number" min={0} max={1440} value={settings.jiraSyncIntervalMinutes}
              onChange={(e) => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 0 && value <= 1440) void update({ jiraSyncIntervalMinutes: value }); }}
              className="tm-w-24 tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded" />
          </Field>
          <div className="tm-flex tm-items-center tm-gap-3">
            <button type="button" disabled={syncing || !services.jiraSyncService} onClick={() => {
              setSyncing(true); setSyncMessage(null);
              void services.jiraSyncService?.sync(settings).then((result) => setSyncMessage(`${result?.created ?? 0} added, ${result?.updated ?? 0} updated`))
                .catch((err: unknown) => setSyncMessage(err instanceof Error ? err.message : String(err))).finally(() => setSyncing(false));
            }} className="tm-px-3 tm-py-1.5 tm-text-sm tm-bg-tm-accent tm-text-white tm-rounded disabled:tm-opacity-50">
              {syncing ? t("settings.jiraSync.syncing") : t("settings.jiraSync.button")}
            </button>
            {syncMessage && <span className="tm-text-sm tm-text-tm-muted">{syncMessage}</span>}
          </div>
        </div>
      </div>

      <div className="tm-border-t tm-border-tm-border tm-pt-5">
        <h3 className="tm-text-base tm-font-medium tm-mb-3">{t("settings.sprint.title")}</h3>
        <div className="tm-flex tm-flex-col tm-gap-4">
          <Field title={t("settings.sprintStart.title")} description={t("settings.sprintStart.desc")}>
            <input type="date" value={settings.sprintStartDate}
              onChange={(e) => void update({ sprintStartDate: e.target.value, lastArchivedSprintEnd: "" })}
              className="tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded" />
          </Field>
          <Field title={t("settings.sprintLength.title")} description={t("settings.sprintLength.desc")}>
            <input type="number" min={1} max={90} value={settings.sprintLengthDays}
              onChange={(e) => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 1 && value <= 90) void update({ sprintLengthDays: value }); }}
              className="tm-w-24 tm-px-2 tm-py-1 tm-bg-tm-bg-alt tm-rounded" />
          </Field>
          <Field title={t("settings.sprintArchive.title")} description={t("settings.sprintArchive.desc")}>
            <label className="tm-inline-flex tm-items-center tm-gap-2">
              <input type="checkbox" checked={settings.autoArchiveDoneAtSprintEnd}
                onChange={(e) => void update({ autoArchiveDoneAtSprintEnd: e.target.checked })} />
            </label>
          </Field>
        </div>
      </div>

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
