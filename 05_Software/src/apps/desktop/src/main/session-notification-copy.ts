import type { HelpLanguage } from "@vera/shared";
import type { NotificationConstructorOptions } from "electron";

const copy = {
  en: {
    completion: "A reply is ready.",
    approval: "An approval request needs your attention.",
    question: "A question is waiting for your answer.",
  },
  ro: {
    completion: "Un răspuns este gata.",
    approval: "O cerere de aprobare necesită atenția ta.",
    question: "O întrebare așteaptă răspunsul tău.",
  },
  de: {
    completion: "Eine Antwort ist verfügbar.",
    approval: "Eine Anfrage wartet auf Ihre Freigabe.",
    question: "Eine Frage wartet auf Ihre Antwort.",
  },
  fr: {
    completion: "Une réponse est prête.",
    approval: "Une demande d’approbation attend votre décision.",
    question: "Une question attend votre réponse.",
  },
} satisfies Record<HelpLanguage, Record<"completion" | "approval" | "question", string>>;

export const windowsNotificationAppId = (testBuild: boolean) =>
  testBuild ? "engineering.ddp.vera.test" : "engineering.ddp.vera";

const escapeXmlText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Windows COM body-click activation matches the launch tag to the live Electron instance. */
export function notificationOptions(
  kind: keyof (typeof copy)["en"],
  language: HelpLanguage,
  tag: string,
  platform: string,
): NotificationConstructorOptions {
  const body = copy[language][kind];
  return {
    title: "VERA",
    body,
    silent: true,
    id: tag,
    ...(platform === "win32" && {
      toastXml: `<toast launch="type=click&amp;tag=${tag}"><visual><binding template="ToastGeneric"><text>VERA</text><text>${escapeXmlText(body)}</text></binding></visual><audio silent="true"/></toast>`,
    }),
  };
}
