import { type DocumentVolume, exceedsDocumentVolume } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { useBytes } from "../../lib/bytes.js";

/**
 * States the count and size of a documentation selection above 2,000 files or 2 GiB. Indexing is
 * never paused by it (TASK-e5310cdb). The Documents section preview, which runs before anything is
 * indexed, has its own wording and also warns when its bounded scan stopped early (RULING-004).
 */
export function VolumeWarning({
  volume,
  preview = false,
}: {
  volume: (DocumentVolume & { truncated?: boolean }) | null | undefined;
  preview?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const bytes = useBytes();
  const truncated = preview && !!volume?.truncated;
  if (!volume || !(exceedsDocumentVolume(volume) || truncated)) return null;
  const values = {
    files: new Intl.NumberFormat(i18n.resolvedLanguage ?? "en").format(volume.files),
    size: bytes(volume.bytes),
  };
  return (
    <p className="volume-warning" role="status" data-volume-warning>
      {!preview
        ? t("documents.volumeWarning", values)
        : truncated
          ? t("documentsSetup.volumeWarningTruncated", values)
          : t("documentsSetup.volumeWarning", values)}
    </p>
  );
}
