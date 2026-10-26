// REQ-FUNC-b3d37df6 REQ-FUNC-997412a4
import { expect, it } from "vitest";
import * as shared from "./index.js";

it("defines strict artifact IPC and portable artifact reference names", () => {
  for (const name of ["artifacts.list", "artifacts.open", "artifacts.reveal", "artifacts.export"] as const) {
    const channel = shared.channels[name];
    expect(channel).toBeDefined();
    expect(
      channel.request.safeParse(
        name === "artifacts.list"
          ? { sessionId: "ses_00000000000000000000000000" }
          : { artifactId: "art_00000000000000000000000000" },
      ).success,
    ).toBe(true);
    expect(channel.request.safeParse({ artifactId: "bad", extra: true }).success).toBe(false);
  }
  expect(shared.formatArtifactRef("summary.md")).toBe("artifact:summary.md");
  expect(shared.parseArtifactRef("artifact:summary.md")).toEqual({ name: "summary.md" });
  for (const ref of [
    "artifact:../x",
    "artifact:CON.txt",
    "artifact:x/y",
    "artifact:",
    "artifact:..",
    "artifact:a.md#L1-L2",
  ])
    expect(shared.parseArtifactRef(ref)).toBeUndefined();
});
