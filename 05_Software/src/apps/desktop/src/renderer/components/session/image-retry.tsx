import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Disclosure } from "./disclosure.js";

/** Select which original attachments to include in the next attempt. */
export function ImageRetry({
  paths,
  hasText,
  retry,
}: {
  paths: readonly string[];
  hasText: boolean;
  retry: (images: string[]) => void;
}) {
  const { t } = useTranslation();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const attachments = [...new Set(paths)];
  const selected = attachments.filter((path) => !excluded.has(path));
  return (
    <Disclosure title={t("chat.changeImagesAndRetry")}>
      <ul className="image-retry-list">
        {attachments.map((path) => (
          <li key={path}>
            <label>
              <input
                type="checkbox"
                checked={!excluded.has(path)}
                onChange={(event) => {
                  const next = new Set(excluded);
                  if (event.target.checked) next.delete(path);
                  else next.add(path);
                  setExcluded(next);
                }}
              />{" "}
              {path}
            </label>
          </li>
        ))}
      </ul>
      <button type="button" disabled={!hasText && !selected.length} onClick={() => retry(selected)}>
        {t("chat.retrySelectedImages")}
      </button>
    </Disclosure>
  );
}
