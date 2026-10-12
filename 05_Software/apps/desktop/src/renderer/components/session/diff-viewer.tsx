export function DiffViewer({ diff, identity }: { diff: string; identity: string }) {
  return (
    <pre className="approval-diff">
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
  );
}
