import type { AppInfo } from "@vera/shared";
import { useTranslation } from "react-i18next";
import ddpLogo from "../assets/ddp-logo-dark.png";
import { type ReleaseCategory, releasesFor } from "../lib/release-notes.js";
import { Metadata } from "./metadata.js";

/** Third-party runtime libraries of the desktop app, read from package-lock.json at build time. */
declare const __VERA_THIRD_PARTY__: { name: string; version: string; license: string }[];
/** VERA's license text (repository LICENSE.txt), embedded at build time. */
declare const __VERA_LICENSE__: string;
/** The release-notes files of 05_Software/release-notes, embedded at build time. */
declare const __VERA_RELEASE_NOTES__: unknown[];
/** The license name (first line) and the "Required Notice:" lines the license asks every copy to carry. */
const licenseLines = __VERA_LICENSE__.split("\n");
const licenseName = licenseLines[0]?.trim() ?? "";
const notices = licenseLines
  .filter((line) => line.startsWith("Required Notice:"))
  .map((line) => line.slice("Required Notice:".length).trim());

export function About({ info }: { info: AppInfo }) {
  const { t, i18n } = useTranslation();
  const releases = releasesFor(__VERA_RELEASE_NOTES__, i18n.resolvedLanguage ?? "en");
  const category: Record<ReleaseCategory, string> = {
    new: t("about.categoryNew"),
    improved: t("about.categoryImproved"),
    fixed: t("about.categoryFixed"),
  };
  const runtime = info.runtime
    ? [
        ["Electron", info.runtime.electron],
        ["Chromium", info.runtime.chrome],
        ["Node.js", info.runtime.node],
        ["V8", info.runtime.v8],
      ]
    : [];
  return (
    <div className="about" data-about>
      <header className="about-hero">
        <div>
          <p className="about-name">{info.name}</p>
          <p className="about-full-name">{t("about.fullName")}</p>
          <p className="about-version" data-about-version>
            {t("about.version", { version: info.version })}
          </p>
          {licenseName && (
            <p className="about-license" data-about-license>
              {licenseName}
            </p>
          )}
          {notices.map((notice) => (
            <p key={notice} className="about-notice">
              {notice}
            </p>
          ))}
        </div>
        <img className="about-logo" src={ddpLogo} alt="DDP Engineering" />
      </header>
      {releases.length > 0 && (
        <details className="about-block about-notices" data-about-whats-new open>
          <summary>
            <h3>{t("about.whatsNew")}</h3>
          </summary>
          {releases.map((release) => (
            <section key={release.version} className="about-release" data-release={release.version}>
              <h4>
                {release.version === "Unreleased"
                  ? t("about.unreleased")
                  : t("about.release", { version: release.version, date: release.date ?? "" })}
              </h4>
              {release.groups.map((group) => (
                <div key={group.category} data-release-category={group.category}>
                  <h5>{category[group.category]}</h5>
                  <ul>
                    {group.items.map((item) => (
                      <li key={`${item.topic}:${item.text}`}>
                        <strong>{item.topic}:</strong> {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </details>
      )}
      <section className="about-block">
        <h3>{t("about.application")}</h3>
        <Metadata info={info} />
      </section>
      {runtime.length > 0 && (
        <section className="about-block">
          <h3>{t("about.runtime")}</h3>
          <dl className="metadata">
            {runtime.map(([name, version]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{version}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {__VERA_LICENSE__ && (
        <details className="about-block about-notices" data-about-license-text>
          <summary>
            <h3>{t("about.license")}</h3>
          </summary>
          <pre className="about-license-text">{__VERA_LICENSE__}</pre>
        </details>
      )}
      {__VERA_THIRD_PARTY__.length > 0 && (
        <details className="about-block about-notices" data-about-notices>
          <summary>
            <h3>{t("about.thirdParty", { count: __VERA_THIRD_PARTY__.length })}</h3>
          </summary>
          <table>
            <thead>
              <tr>
                <th>{t("about.component")}</th>
                <th>{t("about.componentVersion")}</th>
                <th>{t("about.license")}</th>
              </tr>
            </thead>
            <tbody>
              {__VERA_THIRD_PARTY__.map((item) => (
                <tr key={item.name}>
                  <td>{item.name}</td>
                  <td>{item.version}</td>
                  <td>{item.license || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
