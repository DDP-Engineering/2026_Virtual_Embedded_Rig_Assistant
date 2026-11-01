import { useTranslation } from "react-i18next";

export function Plugins() {
  const { t } = useTranslation();
  return (
    <section className="surface" data-plugins>
      <h2>{t("projects.pluginTitle")}</h2>
      <p>{t("projects.pluginIntro")}</p>
      <p role="status">{t("projects.pluginFuture")}</p>
      <p className="muted">{t("projects.pluginPlanned")}</p>
    </section>
  );
}
