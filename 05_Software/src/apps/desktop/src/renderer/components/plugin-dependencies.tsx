import {
  type CatalogPlugin,
  type PluginDependency,
  type PluginPlatform,
  type PluginProgramKind,
  type PluginProgramStatus,
  pluginHintLink,
} from "@vera/shared";
import { useTranslation } from "react-i18next";
import { ExternalSourceLink } from "./session/external-source-link.js";

/** VERA installs the program itself: not a vendor (find) program and not a found external installation. */
export function automaticProgram(status: PluginProgramStatus): boolean {
  return status.kind !== "find" && (!status.external || status.downloadAvailable === true);
}

function useKindLabels(): Record<PluginProgramKind, string> {
  const { t } = useTranslation();
  return {
    pip: t("plugins.dependencies.kind.pip"),
    script: t("plugins.dependencies.kind.script"),
    download: t("plugins.dependencies.kind.download"),
    find: t("plugins.dependencies.kind.find"),
  };
}

/** The plugins a plugin requires, each with whether it is installed on this machine. */
export function RequiredPlugins({
  ids,
  installed,
}: {
  ids: readonly string[];
  installed: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  if (!ids.length) return null;
  return (
    <div data-required-plugins>
      <strong>{t("plugins.requires")}</strong>
      <ul className="plugin-programs">
        {ids.map((id) => (
          <li key={id} data-required-plugin={id} data-installed={installed.has(id)}>
            <div className="plugin-program-heading">
              <code>{id}</code>
              <span className="muted">
                {installed.has(id)
                  ? t("plugins.dependencies.pluginInstalled")
                  : t("plugins.dependencies.pluginMissing")}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A guide text without the link it names, then the link as a confirmed external source. */
export function VendorGuide({ guide, link }: { guide: string; link?: string | undefined }) {
  const { t } = useTranslation();
  return (
    <>
      <p>{link ? guide.replace(link, "").trim() : guide}</p>
      {link && <ExternalSourceLink href={link}>{t("plugins.vendorGuide")}</ExternalSourceLink>}
    </>
  );
}

function Dependency({ item, platform }: { item: PluginDependency; platform?: PluginPlatform | undefined }) {
  const { t, i18n } = useTranslation();
  const kinds = useKindLabels();
  const size = (bytes: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "unit",
      unit: "megabyte",
      maximumFractionDigits: 1,
    }).format(bytes / 1_000_000);
  // The host's download only, once its platform is known.
  const downloads = item.downloads?.filter((entry) => platform === undefined || entry.platform === platform);
  return (
    <li data-dependency={item.name} data-kind={item.kind} data-automatic={item.automatic}>
      <div className="plugin-program-heading">
        <code>{item.name}</code>
        <strong>{kinds[item.kind]}</strong>
        {item.range && <span className="muted">{t("plugins.range", { range: item.range })}</span>}
      </div>
      <p>{item.automatic ? t("plugins.dependencies.automatic") : t("plugins.dependencies.manual")}</p>
      {item.pip && (
        <p>
          <code>{item.pip}</code>
        </p>
      )}
      {item.script && (
        <p>
          <code>{item.script}</code>
        </p>
      )}
      {downloads &&
        (downloads.length ? (
          downloads.map((entry) => (
            <p key={entry.platform} data-download={entry.platform}>
              {entry.platform} ·{" "}
              {entry.bytes !== undefined ? size(entry.bytes) : t("plugins.dependencies.sizeUnknown")} ·
              SHA-256 <code>{entry.sha256}</code>
            </p>
          ))
        ) : (
          <p className="muted">{t("plugins.dependencies.noDownload")}</p>
        ))}
      {!item.automatic && item.guide && <VendorGuide guide={item.guide} link={pluginHintLink(item.guide)} />}
    </li>
  );
}

/**
 * What a catalog plugin needs, from the index alone (no package download): the plugins it requires and each
 * program, installed by VERA into its program folder or left to the user with its vendor guide.
 */
export function CatalogDependencies({
  entry,
  platform,
  installed,
}: {
  entry: CatalogPlugin;
  platform?: PluginPlatform | undefined;
  installed: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  return (
    <section className="plugin-expanded" data-catalog-dependencies>
      <strong>{t("plugins.dependencies.title")}</strong>
      <RequiredPlugins ids={entry.requires} installed={installed} />
      {entry.dependencies.length ? (
        <ul className="plugin-programs" aria-label={t("plugins.programs")}>
          {entry.dependencies.map((item) => (
            <Dependency key={item.name} item={item} platform={platform} />
          ))}
        </ul>
      ) : (
        <p className="muted">{t("plugins.composition.noPrograms")}</p>
      )}
    </section>
  );
}
