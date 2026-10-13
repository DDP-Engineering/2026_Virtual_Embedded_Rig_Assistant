import { useTranslation } from "react-i18next";

export function DiffViewer({ diff, identity }: { diff: string; identity: string }) {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Named diff region receives keyboard scrolling.
    <section className="approval-diff" aria-label={t("approval.diff")} tabIndex={0}>
      <pre>
        {diff.split("\n").map((line, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: Immutable patch lines have fixed positions; repeated context lines need position identity.
            key={`${identity}/${index}/${line}`}
            className={
              line.startsWith("+") && !line.startsWith("+++")
                ? "diff-added"
                : line.startsWith("-") && !line.startsWith("---")
                  ? "diff-removed"
                  : "diff-context"
            }
          >
            {line}
            {"\n"}
          </span>
        ))}
      </pre>
    </section>
  );
}
