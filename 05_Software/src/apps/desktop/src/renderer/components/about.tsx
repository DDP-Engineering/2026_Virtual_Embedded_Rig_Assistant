import type { AppInfo } from "@vera/shared";
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Metadata } from "./metadata.js";

/** Third-party runtime libraries of the desktop app, read from package-lock.json at build time. */
declare const __VERA_THIRD_PARTY__: { name: string; version: string; license: string }[];

export function About({ info }: { info: AppInfo }) {
  const { t } = useTranslation();
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
        <Activity aria-hidden="true" />
        <div>
          <p className="about-name">{info.name}</p>
          <p className="about-full-name">{t("about.fullName")}</p>
          <p className="about-version" data-about-version>
            {t("about.version", { version: info.version })}
          </p>
        </div>
      </header>
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
