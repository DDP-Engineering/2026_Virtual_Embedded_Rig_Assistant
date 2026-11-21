import { type DocumentVolume, documentVolumeLimit, exceedsDocumentVolume } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { useBytes } from "../../lib/bytes.js";

/**
 * Warns before saving a documentation selection above the resolved Document volume warning (2,000 files or
 * 2 GiB by default, REQ-UX-d64e808a), or when the bounded preview scan stopped early. This advisory never
 * pauses indexing.
 */
export function VolumeWarning({
  volume,
  limit = documentVolumeLimit,
}: {
  volume: (DocumentVolume & { truncated?: boolean }) | null | undefined;
  limit?: DocumentVolume;
}) {
  const { t, i18n } = useTranslation();
  const bytes = useBytes();
  const truncated = !!volume?.truncated;
  if (!volume || !(exceedsDocumentVolume(volume, limit) || truncated)) return null;
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
