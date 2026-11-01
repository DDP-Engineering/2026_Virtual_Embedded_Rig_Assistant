import { useTranslation } from "react-i18next";

/** Formats a byte count in the UI language with binary steps (1 KB = 1024 bytes). */
export function useBytes() {
  const { i18n } = useTranslation();
  return (bytes: number) => {
    const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return new Intl.NumberFormat(i18n.resolvedLanguage ?? "en", {
      style: "unit",
      unit: units[unit],
      unitDisplay: "short",
      maximumFractionDigits: unit ? 1 : 0,
    }).format(value);
  };
}
