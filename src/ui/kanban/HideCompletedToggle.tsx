import * as React from "react";
import { useStore, useServices } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";

export const HideCompletedToggle: React.FC = () => {
  const services = useServices();
  const hide = useStore((s) => s.hideCompleted);

  return (
    <label className="tm-flex tm-items-center tm-gap-2 tm-text-sm tm-text-tm-text">
      <input
        type="checkbox"
        checked={hide}
        onChange={(e) => services.store.getState().setHideCompleted(e.target.checked)}
      />
      {t("header.hideCompleted")}
    </label>
  );
};
