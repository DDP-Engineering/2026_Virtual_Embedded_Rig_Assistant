// REQ-REL-6b7f009b REQ-UX-a033771c
import { GIT_HISTORY_PAGE_SIZE, type GitHistoryResponse } from "@vera/shared";
import { useTranslation } from "react-i18next";

export function GitHistoryView({ response }: { response: GitHistoryResponse }) {
  const { t, i18n } = useTranslation();
  const { displayPath, result } = response;
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const notice = {
    ready: undefined,
    unborn: t("gitHistory.unborn"),
    empty: t("gitHistory.empty"),
    unavailable: t("gitHistory.unavailable"),
    malformed: t("gitHistory.malformed"),
    "read-limit": t("gitHistory.readLimit"),
  }[result.state];
  return (
    <section className="git-history" aria-label={t("gitHistory.view")}>
      <header>
        <h2>{displayPath}</h2>
        <p>{t("gitHistory.localHead")}</p>
      </header>
      {notice && <p role="status">{notice}</p>}
      {"scopeBoundary" in result && result.scopeBoundary && <p>{t("gitHistory.scopeBoundary")}</p>}
      {result.state === "ready" && (
        <>
          <ol>
            {result.commits.map((commit) => (
              <li key={commit.hash}>
                <bdi>{commit.subject || t("gitHistory.noSubject")}</bdi>
                <div>
                  <code>{commit.hash}</code>
                  <bdi>{commit.author || t("gitHistory.noAuthor")}</bdi>
                  <time dateTime={commit.date}>{date.format(new Date(commit.date))}</time>
                </div>
              </li>
            ))}
          </ol>
          {result.capped && <p role="status">{t("gitHistory.capped", { limit: GIT_HISTORY_PAGE_SIZE })}</p>}
        </>
      )}
    </section>
  );
}
