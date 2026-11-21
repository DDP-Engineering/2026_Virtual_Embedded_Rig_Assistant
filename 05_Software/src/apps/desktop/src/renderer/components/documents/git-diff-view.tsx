// REQ-REL-c097dfac REQ-UX-c4e574c0
import type { GitDiffResponse } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { PatchDocument } from "./patch-document.js";

export function GitDiffView({ response, identity }: { response: GitDiffResponse; identity: string }) {
  const { t } = useTranslation();
  const { displayPath, result } = response;
  const comparison = {
    index: t("gitDiff.index"),
    head: t("gitDiff.head"),
    "empty-tree": t("gitDiff.emptyTree"),
    unknown: t("gitDiff.stagedUnknown"),
  }[result.base];
  const notice =
    result.state === "patch"
      ? undefined
      : {
          empty: t("gitDiff.empty"),
          binary: t("gitDiff.binary"),
          "too-large": t("gitDiff.tooLarge"),
          conflict: t("gitDiff.conflict"),
          unavailable: t("gitDiff.unavailable"),
        }[result.state];
  return (
    <PatchDocument
      path={displayPath}
      comparison={comparison}
      identity={identity}
      detail={
        result.rename && <p>{t("gitDiff.rename", { from: result.rename.from, to: result.rename.to })}</p>
      }
      patch={result.state === "patch" ? result.patch : undefined}
      notice={notice}
    />
  );
}
