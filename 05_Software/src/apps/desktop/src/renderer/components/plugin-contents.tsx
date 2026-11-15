import type {
  PluginComposition,
  PluginManifest,
  PluginProgram,
  PluginReview,
  PluginRisk,
} from "@vera/shared";
import { pluginOperations, pluginText } from "@vera/shared";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { helpLanguage } from "./help.js";
import { MaturityBadge } from "./plugin-library-controls.js";
import { Markdown } from "./session/markdown.js";

/** The approval prompt's risk labels, so the page and the prompt name a risk the same way. */
export function useRiskLabels(): Record<PluginRisk, string> {
  const { t } = useTranslation();
  return {
    safe: t("approval.risk.safe"),
    "device-read": t("approval.risk.deviceRead"),
    "device-write": t("approval.risk.deviceWrite"),
    irreversible: t("approval.risk.irreversible"),
    blocked: t("approval.risk.blocked"),
  };
}
/** Where a program comes from: its install kind with the requirement, script path, search roots or downloads. */
function InstallSource({ program }: { program: PluginProgram }) {
  const { t } = useTranslation();
  const { install } = program;
  if ("pip" in install) return <span>{t("plugins.source.pip", { requirement: install.pip })}</span>;
  if ("script" in install) return <span>{t("plugins.source.script", { path: install.script })}</span>;
  return (
    <>
      {"find" in install && (
        <>
          <span>{t("plugins.source.find")}</span>{" "}
          <code>{[...(install.find.windows ?? []), ...(install.find.linux ?? [])].join(", ")}</code>
          {install.hint && <span className="muted"> {install.hint}</span>}
        </>
      )}
      {"download" in install && install.download && (
        <ul>
          {Object.entries(install.download).map(([platform, entry]) => (
            <li key={platform}>
              {t("plugins.source.download", { platform })} <code>{entry?.url}</code>{" "}
              <span className="plugin-sha">SHA-256 {entry?.sha256}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
/**
 * What a plugin brings and what it may do, from its manifest and package composition: the same view before
 * install (the reviewed package) and after (the installed package), one section per kind. Operations are the
 * manifest rules the approval policy classifies with, one collapsed group per risk so large plugins stay readable.
 */
export function PluginContents({
  manifest,
  composition,
}: {
  manifest: PluginManifest;
  composition?: PluginComposition | undefined;
}) {
  const { t } = useTranslation();
  const risk = useRiskLabels();
  const programs = Object.entries(manifest.programs);
  const skills = composition?.skills ?? [];
  const files = composition?.files ?? [];
  const groups = pluginOperations(manifest.rules);
  return (
    <>
      <section className="plugin-section" data-plugin-section="programs">
        <h4>{t("plugins.programs")}</h4>
        {programs.length === 0 ? (
          <p data-no-programs>{t("plugins.composition.noPrograms")}</p>
        ) : (
          <ul className="plugin-review-list">
            {programs.map(([name, program]) => (
              <li key={name} data-program={name}>
                <code>{name}</code> <InstallSource program={program} />
                {program.version.range && (
                  <span className="muted"> {t("plugins.range", { range: program.version.range })}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {skills.length > 0 && (
        <section className="plugin-section" data-plugin-section="skills">
          <h4>{t("plugins.composition.skills")}</h4>
          <ul className="plugin-review-list">
            {skills.map((skill) => (
              <li key={skill.name} data-skill={skill.name}>
                <code>{skill.name}</code>
                {skill.description && <span> {skill.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {files.length > 0 && (
        <section className="plugin-section" data-plugin-section="files">
          <h4>{t("plugins.composition.files")}</h4>
          <ul className="plugin-review-list">
            {files.map((file) => (
              <li key={file} data-file={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {manifest.docs.length > 0 && (
        <section className="plugin-section" data-plugin-section="docs">
          <h4>{t("plugins.docs")}</h4>
          <ul className="plugin-review-list">
            {manifest.docs.map((doc) => (
              <li key={doc} data-doc={doc}>
                <code>{doc}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="plugin-section" data-plugin-section="operations" data-plugin-operations>
        <h4>{t("plugins.operations.title")}</h4>
        {groups.length === 0 && <p>{t("plugins.operations.none")}</p>}
        {groups.map((group) => (
          <details key={group.risk} className="plugin-operations" data-operations={group.risk}>
            <summary>
              <span className="risk-badge" data-risk={group.risk}>
                {risk[group.risk]}
              </span>{" "}
              <span className="muted">{group.rules.length}</span>
            </summary>
            <ul className="plugin-review-list">
              {group.rules.map((rule, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rules keep manifest order and may repeat.
                <li key={index} data-rule={rule.risk}>
                  <code>{rule.match}</code>
                  {rule.note && <span> {rule.note}</span>}
                  {rule.timeout !== undefined && (
                    <span className="muted"> {t("plugins.timeout", { seconds: rule.timeout })}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </>
  );
}

/**
 * Everything about one plugin, in the same sections before install, in the review and after install:
 * description, facts, any installed-only sections (`children`), its help page and its contents.
 */
export function PluginDetails({
  manifest,
  composition,
  help,
  facts,
  children,
}: {
  manifest: PluginManifest;
  composition?: PluginComposition | undefined;
  /** The plugin's help page in the interface language (English when it has no page in that language). */
  help?: string | undefined;
  /** More facts under the plugin's own, such as the catalog's activity and dates. */
  facts?: ReactNode;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="plugin-details-body" data-plugin-contents>
      <section className="plugin-section" data-plugin-section="description">
        <h4>{t("plugins.details.description")}</h4>
        <p>{pluginText(manifest, i18n.language).description}</p>
      </section>
      <section className="plugin-section" data-plugin-section="about">
        <h4>{t("plugins.details.about")}</h4>
        <dl className="plugin-facts">
          <dt>{t("plugins.id")}</dt>
          <dd>
            <code>{manifest.id}</code>
          </dd>
          <dt>{t("plugins.version")}</dt>
          <dd>
            {manifest.version} <MaturityBadge version={manifest.version} />
          </dd>
          {manifest.license && (
            <>
              <dt>{t("plugins.details.license")}</dt>
              <dd>{manifest.license}</dd>
            </>
          )}
          <dt>{t("plugins.platforms")}</dt>
          <dd>{manifest.platforms.join(", ")}</dd>
          <dt>{t("plugins.requires")}</dt>
          <dd>{manifest.requires.length ? manifest.requires.join(", ") : t("plugins.nothing")}</dd>
        </dl>
        {facts}
      </section>
      {children}
      {help && (
        <section className="plugin-section" data-plugin-section="help">
          <h4>{t("plugins.help")}</h4>
          <div className="plugin-help">
            <Markdown text={help} />
          </div>
        </section>
      )}
      <PluginContents manifest={manifest} composition={composition} />
    </div>
  );
}

/** The help page of a review in `language`, else the English one. */
export function reviewHelp(review: PluginReview | undefined, language: string): string | undefined {
  return review?.help?.[helpLanguage(language)] ?? review?.help?.en;
}
