import type { ReactNode } from "react";
import { DiffViewer } from "../session/diff-viewer.js";

/** Displays a projected patch and its source details in a central document panel. */
export function PatchDocument({
  path,
  comparison,
  detail,
  identity,
  patch,
  notice,
}: {
  path: string;
  comparison: string;
  detail?: ReactNode;
  identity: string;
  patch?: string | undefined;
  notice?: string | undefined;
}) {
  return (
    <div className="patch-document">
      <header>
        <h3>
          <bdi>{path}</bdi>
        </h3>
        <p>{comparison}</p>
        {detail}
      </header>
      {patch !== undefined ? <DiffViewer diff={patch} identity={identity} /> : <p role="status">{notice}</p>}
    </div>
  );
}
