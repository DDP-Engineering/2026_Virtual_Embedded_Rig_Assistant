// REQ-UX-58cf59b2 REQ-UX-fe9ec5c2 REQ-UX-3eb27a6c
import { useEffect, useRef } from "react";

/**
 * The small field a document shows only when asked (Ctrl+F to find, Ctrl+G to go to a line;
 * TASK-4c04273a). Enter and Shift+Enter step forward and back; Escape closes it and hands focus
 * back to the document instead of leaving the tab.
 */
export function FindBar({
  label,
  value,
  status,
  numeric = false,
  change,
  step,
  close,
}: {
  label: string;
  value: string;
  /** "3 of 12" and the like, read out politely. */
  status?: string | undefined;
  numeric?: boolean;
  change: (value: string) => void;
  step: (forward: boolean) => void;
  close: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <div className="document-find" data-document-find>
      <input
        ref={input}
        data-document-search={numeric ? undefined : ""}
        data-document-goto={numeric ? "" : undefined}
        type={numeric ? "number" : "search"}
        inputMode={numeric ? "numeric" : undefined}
        min={numeric ? 1 : undefined}
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            step(!event.shiftKey);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      />
      {status !== undefined && (
        <span role="status" aria-live="polite">
          {status}
        </span>
      )}
    </div>
  );
}
