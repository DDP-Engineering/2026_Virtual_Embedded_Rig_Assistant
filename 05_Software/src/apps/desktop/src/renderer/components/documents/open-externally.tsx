import { opensExternally } from "@vera/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";

/** Whether a source path is a workbench document the default application may open. */
export const canOpenExternally = (path: string) => opensExternally(path) && !path.startsWith(".vera/");

/** "Open in default app" for an allowlisted workbench document; failures stay beside the button. */
export function OpenExternally({ path }: { path: string }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  if (!canOpenExternally(path)) return null;
  return (
    <>
      <button
        type="button"
        data-action="open-external"
        aria-label={t("documents.openExternalNamed", { path })}
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(undefined);
          void api
            .invoke("app.openPath", { path })
            .catch(setError)
            .finally(() => setPending(false));
        }}
      >
        {t("documents.openExternal")}
      </button>
      {error !== undefined && <ErrorMessage error={error} />}
    </>
  );
}
