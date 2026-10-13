// REQ-UX-194ecc98
import { useTranslation } from "react-i18next";

export function DemoGuide({
  disabled,
  choose,
  configure,
}: {
  disabled: boolean;
  choose: (text: string) => void;
  configure: () => void;
}) {
  const { t } = useTranslation();
  const prompts = [
    { name: "datasheet-reader", title: t("demo.datasheetTitle"), text: t("demo.datasheetPrompt") },
    { name: "log-analyst", title: t("demo.logTitle"), text: t("demo.logPrompt") },
    { name: "bringup-checklist", title: t("demo.checklistTitle"), text: t("demo.checklistPrompt") },
  ];
  return (
    <section className="surface" aria-labelledby="demo-guide-title" data-demo-guide>
      <h3 id="demo-guide-title">{t("demo.guideTitle")}</h3>
      <p>{t("demo.fictional")}</p>
      <ol>
        <li>
          {t("demo.configureStep")}{" "}
          <button type="button" onClick={configure}>
            {t("demo.configure")}
          </button>
        </li>
        <li>{t("demo.promptStep")}</li>
        <li>{t("demo.citationStep")}</li>
      </ol>
      <p className="muted">{t("demo.returnStep")}</p>
      {prompts.map((prompt) => (
        <div key={prompt.name}>
          <h4>{prompt.title}</h4>
          <p>{prompt.text}</p>
          <button
            type="button"
            data-demo-prompt={prompt.name}
            disabled={disabled}
            onClick={() => choose(prompt.text)}
          >
            {t("demo.usePrompt", { title: prompt.title })}
          </button>
        </div>
      ))}
    </section>
  );
}
