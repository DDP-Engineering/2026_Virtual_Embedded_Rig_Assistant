import type { PluginComposition, PluginManifest, PluginProgram, PluginRisk } from "@vera/shared";
import { pluginOperations } from "@vera/shared";
import { useTranslation } from "react-i18next";

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
 * install (the reviewed package) and after (the installed package). Operations are the manifest rules the approval
 * policy classifies with, one collapsed group per risk so large plugins stay readable.
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
    <div className="plugin-contents" data-plugin-contents>
      <section data-plugin-composition>
        <h4>{t("plugins.composition.title")}</h4>
        <h5>{t("plugins.programs")}</h5>
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
        {skills.length > 0 && (
          <>
            <h5>{t("plugins.composition.skills")}</h5>
            <ul className="plugin-review-list">
              {skills.map((skill) => (
                <li key={skill.name} data-skill={skill.name}>
                  <code>{skill.name}</code>
                  {skill.description && <span> {skill.description}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {files.length > 0 && (
          <>
            <h5>{t("plugins.composition.files")}</h5>
            <ul className="plugin-review-list">
              {files.map((file) => (
                <li key={file} data-file={file}>
                  <code>{file}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        {manifest.docs.length > 0 && (
          <>
            <h5>{t("plugins.docs")}</h5>
            <ul className="plugin-review-list">
              {manifest.docs.map((doc) => (
                <li key={doc} data-doc={doc}>
                  <code>{doc}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section data-plugin-operations>
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
    </div>
  );
}
