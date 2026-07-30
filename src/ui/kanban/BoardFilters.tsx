import * as React from "react";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { PriorityFilter } from "../../store/taskMasterStore";

export const BoardFilters: React.FC = () => {
  const services = useServices();
  const searchQuery = useStore((s) => s.searchQuery);
  const priorityFilter = useStore((s) => s.priorityFilter);

  return (
    <div className="tm-flex tm-flex-wrap tm-items-center tm-gap-2">
      <input
        type="search"
        value={searchQuery}
        onChange={(event) => services.store.getState().setSearchQuery(event.target.value)}
        aria-label={t("header.search")}
        placeholder={t("header.searchPlaceholder")}
        className="tm-w-40 tm-rounded tm-border tm-border-tm-border tm-bg-tm-bg tm-px-2 tm-py-1 tm-text-sm"
      />
      <select
        value={priorityFilter}
        onChange={(event) =>
          services.store.getState().setPriorityFilter(event.target.value as PriorityFilter)}
        aria-label={t("header.priorityFilter")}
        className="tm-rounded tm-border tm-border-tm-border tm-bg-tm-bg tm-px-2 tm-py-1 tm-text-sm"
      >
        <option value="all">{t("header.priorityAll")}</option>
        <option value="high">{t("modal.task.priorityHigh")}</option>
        <option value="medium">{t("modal.task.priorityMedium")}</option>
        <option value="low">{t("modal.task.priorityLow")}</option>
      </select>
    </div>
  );
};
