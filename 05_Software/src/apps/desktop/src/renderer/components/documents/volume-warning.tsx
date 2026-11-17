import { type DocumentVolume, exceedsDocumentVolume } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { useBytes } from "../../lib/bytes.js";

/**
 * Warns before saving a documentation selection above 2,000 files or 2 GiB, or when the
 * bounded preview scan stopped early. This advisory never pauses indexing.
 */
export function VolumeWarning({
  volume,
}: {
  volume: (DocumentVolume & { truncated?: boolean }) | null | undefined;
}) {
  const { t, i18n } = useTranslation();
  const bytes = useBytes();
  const truncated = !!volume?.truncated;
  if (!volume || !(exceedsDocumentVolume(volume) || truncated)) return null;
  const values = {
    files: new Intl.NumberFormat(i18n.resolvedLanguage ?? "en").format(volume.files),
    size: bytes(volume.bytes),
  };
  return (
    <p className="volume-warning" role="status" data-volume-warning>
      {truncated
        ? t("documentsSetup.volumeWarningTruncated", values)
        : t("documentsSetup.volumeWarning", values)}
    </p>
  );
}
