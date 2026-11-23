import { useMutation } from "@tanstack/react-query";
import type { ChangeDetail } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { PatchDocument } from "./patch-document.js";

/** Shows the recorded edit in the document area and keeps reveal feedback with that edit. */
export function SessionChangeDiff({ change, identity }: { change: ChangeDetail; identity: string }) {
  const { t, i18n } = useTranslation();
  const reveal = useMutation({
    mutationFn: () => api.invoke("app.revealPath", { path: change.path }),
  });
  return (
    <PatchDocument
      path={change.path}
      comparison={t("changes.recordedAt", { time: new Date(change.createdAt).toLocaleString(i18n.language) })}
      identity={identity}
      patch={change.diff}
      detail={
        <>
          <button type="button" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
            {t("changes.reveal")}
          </button>
          {reveal.isError && <ErrorMessage error={reveal.error} />}
        </>
      }
    />
  );
}
