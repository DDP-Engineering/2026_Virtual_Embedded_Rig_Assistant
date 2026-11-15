import { useQuery } from "@tanstack/react-query";
import { type HelpLanguage, helpLanguageSchema } from "@vera/shared";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { Markdown } from "./session/markdown.js";

/** The help language for an interface language; English for anything help is not written in. */
export function helpLanguage(language: string | undefined): HelpLanguage {
  return helpLanguageSchema.catch("en").parse(language);
}

/** Help: the selected page on the left, the page list on the right (REQ-UX-3de89feb). */
export function HelpView({ page, open }: { page: string; open: (page: string) => void }) {
  const { t, i18n } = useTranslation();
  const language = helpLanguage(i18n.resolvedLanguage ?? i18n.language);
  const list = useQuery({
    queryKey: ["help.list", language],
    queryFn: () => api.invoke("help.list", { language }),
  });
  const content = useQuery({
    queryKey: ["help.read", page, language],
    queryFn: () => api.invoke("help.read", { page, language }),
  });
  // Links to other help pages open them here; everything else keeps the Markdown default (REQ-UX-2eb10026).
  const link = useCallback(
    (href: string) => {
      const target = /^([a-z0-9][a-z0-9-]{0,63})\.md(?:#.*)?$/.exec(href)?.[1];
      return target ? { page: target, open: () => open(target) } : undefined;
    },
    [open],
  );
  return (
    <div className="help-view" data-help-view>
      <article className="help-page" data-help-current={page} lang={content.data?.language}>
        {content.isError ? (
          <ErrorMessage error={content.error} />
        ) : (
          content.data && <Markdown text={content.data.content} link={link} />
        )}
      </article>
      <nav className="help-pages" aria-label={t("help.pages")}>
        {list.isError && <ErrorMessage error={list.error} />}
        <ul>
          {list.data?.map((entry) => (
            <li key={entry.page}>
              <button
                type="button"
                data-help-page={entry.page}
                aria-current={entry.page === page ? "page" : undefined}
                lang={entry.language}
                onClick={() => open(entry.page)}
              >
                {entry.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
