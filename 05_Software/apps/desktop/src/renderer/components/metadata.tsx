import type { AppInfo } from "@vera/shared";
import { useTranslation } from "react-i18next";

export function Metadata({ info }: { info: AppInfo }) {
  const { t } = useTranslation();
  const fields = [
    { field: "name", label: t("home.name"), value: info.name },
    { field: "version", label: t("home.version"), value: info.version },
    { field: "platform", label: t("home.platform"), value: info.platform },
    { field: "arch", label: t("home.arch"), value: info.arch },
    { field: "portable", label: t("home.portable"), value: info.portable ? t("home.yes") : t("home.no") },
    { field: "locale", label: t("home.locale"), value: info.locale },
  ];
  return (
    <dl className="metadata">
      {fields.map(({ field, label, value }) => (
        <div key={field}>
          <dt data-i18n={`home.${field}`}>{label}</dt>
          <dd data-info={field}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
