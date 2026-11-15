import { useQuery } from "@tanstack/react-query";
import { type HelpLanguage, type HelpPageSummary, helpLanguageSchema, parseRef } from "@vera/shared";
import { createContext, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { Pager, usePaged } from "./pager.js";
import { Markdown } from "./session/markdown.js";

/** The help language for an interface language; English for anything help is not written in. */
export function helpLanguage(language: string | undefined): HelpLanguage {
  return helpLanguageSchema.catch("en").parse(language);
}

/** The Help view's page key of a plugin's help page; app pages use their page name. */
export function pluginHelpKey(id: string): string {
  return `plugin/${id}`;
}

/** The Help view's page key of a `help:` citation, else undefined (REQ-UX-a318156e). */
export function helpCitationKey(ref: string): string | undefined {
  const parsed = parseRef(ref);
  if (parsed?.kind !== "help") return undefined;
  return "plugin" in parsed ? pluginHelpKey(parsed.plugin) : parsed.page;
}

/** Opens Help at a page key from anywhere in the shell (the plugin rows' Help buttons). */
export const HelpContext = createContext<((page: string) => void) | undefined>(undefined);

/** Help: the selected page on the left, the page lists on the right (REQ-UX-3de89feb). */
export function HelpView({ page, open }: { page: string; open: (page: string) => void }) {
  const { t, i18n } = useTranslation();
  const language = helpLanguage(i18n.resolvedLanguage ?? i18n.language);
  const plugin = page.startsWith("plugin/") ? page.slice("plugin/".length) : undefined;
  const list = useQuery({
    queryKey: ["help.list", language],
    queryFn: () => api.invoke("help.list", { language }),
  });
  const content = useQuery({
    queryKey: ["help.read", page, language],
    queryFn: () => api.invoke("help.read", plugin === undefined ? { page, language } : { plugin, language }),
  });
  // Links to other help pages open them here; everything else keeps the Markdown default (REQ-UX-2eb10026).
  const link = useCallback(
    (href: string) => {
      const target = /^([a-z0-9][a-z0-9-]{0,63})\.md(?:#.*)?$/.exec(href)?.[1];
      return target ? { page: target, open: () => open(target) } : undefined;
    },
    [open],
  );
  const pages = list.data?.filter((entry) => !entry.plugin) ?? [];
  const plugins = list.data?.filter((entry) => entry.plugin) ?? [];
  const paged = usePaged(plugins);
  const entry = (summary: HelpPageSummary) => {
    const key = summary.plugin ? pluginHelpKey(summary.plugin) : summary.page;
    return (
      <li key={key}>
        <button
          type="button"
          data-help-page={key}
          aria-current={key === page ? "page" : undefined}
          lang={summary.language}
          onClick={() => open(key)}
        >
          {summary.title}
        </button>
      </li>
    );
  };
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
        <ul>{pages.map(entry)}</ul>
        {plugins.length > 0 && (
          <>
            <h3>{t("help.plugins")}</h3>
            <ul data-help-plugins>{paged.rows.map(entry)}</ul>
            <Pager {...paged.pager} />
          </>
        )}
      </nav>
    </div>
  );
}
