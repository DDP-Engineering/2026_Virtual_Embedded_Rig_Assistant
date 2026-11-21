import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RetrievalLimitation } from "./transcript-projection.js";

export function RetrievalNotice({
  turnId,
  limitations,
}: {
  turnId: string | null;
  limitations: ReadonlySet<RetrievalLimitation>;
}) {
  const { t } = useTranslation();
  const labels: Record<RetrievalLimitation, () => string> = {
    partial: () => t("documents.turnSearchPartial"),
    unknown: () => t("documents.turnSearchUnknown"),
    "embedding-rebuild": () => t("documents.turnSearchRebuild"),
    "semantic-unavailable": () => t("documents.turnSearchKeyword"),
    "revision-conflict": () => t("documents.turnSearchConflict"),
    unavailable: () => t("documents.turnSearchUnavailable"),
    "index-not-ready": () => t("documents.turnSearchNotReady"),
  };
  const messages = Array.from(limitations, (limitation) => labels[limitation]());
  return (
    <p className="transcript-item retrieval-notice" data-retrieval-notice={turnId ?? ""}>
      <Info aria-hidden="true" />
      <span>{messages.join(" ")}</span>
    </p>
  );
}
