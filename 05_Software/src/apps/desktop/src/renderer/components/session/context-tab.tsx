// REQ-UX-4bea0007
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { SkillSettings } from "../skills.js";
import { Markdown } from "./markdown.js";
export function ContextTab({ workbenchId, readOnly = false }: { workbenchId: string; readOnly?: boolean }) {
  const { t } = useTranslation();
  const pinned = useQuery({
    queryKey: ["context.pinned", workbenchId],
    queryFn: () => api.invoke("workbench.pinned.get", {}),
  });
  const skills = useQuery({
    queryKey: ["skills", workbenchId],
    queryFn: () => api.invoke("skills.list", { workbenchId }),
  });
  return (
    <div className="context-tab">
      <h3>.vera/WORKBENCH.md</h3>
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
      <SkillSettings workbenchId={workbenchId} readOnly={readOnly} />
      {skills.isPending && <p role="status">{t("home.loading")}</p>}
      {skills.isError && <ErrorMessage error={skills.error} />}
      {skills.data?.filter((s) => s.enabled && !s.error).length === 0 && (
        <p className="muted">{t("chat.noSkills")}</p>
      )}
      <ul className="skills-list">
        {skills.data
          ?.filter((s) => s.enabled && !s.error)
          .map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong>
              <p>{s.description}</p>
            </li>
          ))}
      </ul>
    </div>
  );
}
