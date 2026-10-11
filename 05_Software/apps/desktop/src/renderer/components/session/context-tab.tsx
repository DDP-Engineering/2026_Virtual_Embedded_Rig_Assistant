// REQ-UX-4bea0007
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { Markdown } from "./markdown.js";
export function ContextTab({ workbenchId }: { workbenchId: string }) {
  const { t } = useTranslation();
  const pinned = useQuery({
    queryKey: ["context.pinned", workbenchId],
    queryFn: () => api.invoke("workbench.pinned.get", {}),
  });
  return (
    <div className="context-tab">
      <h3>WORKBENCH.md</h3>
      {pinned.data && <Markdown text={pinned.data.content} />}
      {pinned.isPending && <p role="status">{t("home.loading")}</p>}
      {pinned.isError && (
        <>
          <ErrorMessage error={pinned.error} />
          <button type="button" onClick={() => void pinned.refetch()}>
            {t("settings.retry")}
          </button>
        </>
      )}
      <h3>{t("chat.skills")}</h3>
      <p className="muted">{t("chat.noSkills")}</p>
    </div>
  );
}
