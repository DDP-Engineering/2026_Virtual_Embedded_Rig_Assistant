import type { SessionItemDetailField, SessionState } from "@vera/shared";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";

/** Above this many characters a full text renders as one plain `<pre>`, without per-line markup. */
export const PLAIN_TEXT_CHARS = 256 * 1024;

type Tool = Extract<SessionState["items"][number], { kind: "tool" }>;
/** The arguments as shown: a cut value is already the prefix of its JSON (PERF-06). */
export function argsText(item: Tool, pretty = true): string {
  if (item.truncated?.args !== undefined) return String(item.args);
  return JSON.stringify(item.args, null, pretty ? 2 : undefined) ?? "";
}

/**
 * A snapshot field the renderer may hold as an excerpt (PERF-06). With `totalBytes`, a button loads
 * the full text from the item's stored event through `session.item.detail` and shows it instead.
 */
export function BoundedText({
  sessionId,
  itemId,
  field,
  text,
  totalBytes,
  children,
}: {
  sessionId: string | undefined;
  itemId: string;
  field: SessionItemDetailField;
  text: string;
  totalBytes: number | undefined;
  children: (text: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const [full, setFull] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  if (totalBytes === undefined || full !== undefined) return children(full ?? text);
  return (
    <>
      {children(text)}
      {sessionId && (
        <button
          type="button"
          data-show-full={field}
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(undefined);
            try {
              setFull((await api.invoke("session.item.detail", { sessionId, itemId, field })).text);
            } catch (failure) {
              setError(failure);
            } finally {
              setPending(false);
            }
          }}
        >
          {t("chat.showFull", { size: Math.max(1, Math.round(totalBytes / 1024)) })}
        </button>
      )}
      {error !== undefined && <ErrorMessage error={error} />}
    </>
  );
}

/** A tool's arguments and output; cut fields (PERF-06) load in full on request. */
export function ToolOutput({
  item,
  update,
  sessionId,
}: {
  item: Tool;
  update: string | undefined;
  sessionId: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h4>{t("chat.arguments")}</h4>
      <BoundedText
        sessionId={sessionId}
        itemId={item.id}
        field="args"
        text={argsText(item)}
        totalBytes={item.truncated?.args}
      >
        {(text) => <pre>{text}</pre>}
      </BoundedText>
      <h4>{t("chat.preview")}</h4>
      {item.preview === undefined ? (
        <pre>{update ?? item.summary ?? t("chat.noPreview")}</pre>
      ) : (
        <BoundedText
          sessionId={sessionId}
          itemId={item.id}
          field="preview"
          text={item.preview}
          totalBytes={item.truncated?.preview}
        >
          {(text) => <pre>{text}</pre>}
        </BoundedText>
      )}
    </>
  );
}
