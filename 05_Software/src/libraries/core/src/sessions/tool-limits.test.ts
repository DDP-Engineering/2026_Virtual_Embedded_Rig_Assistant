// REQ-FUNC-f6f79cd2 REQ-FUNC-f041ba07
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { durableSetup, scriptedGateway } from "./compaction-durable.test.js";

/** The tool result text the model received after the scripted read of big.txt. */
async function readResult(app: Record<string, unknown>, lines: number) {
  const gateway = scriptedGateway(400_000, () => 0);
  const env = await durableSetup(gateway);
  await writeFile(
    join(env.host.root, "big.txt"),
    Array.from({ length: lines }, (_, line) => `line ${line} ${"x".repeat(70)}`).join("\n"),
  );
  env.host.advanced = { app: () => app, workbench: () => ({}) };
  const id = env.service.create().id;
  env.service.send(id, "please READFILE");
  expect((await env.service.waitIdle(id))?.stopReason).toBe("end");
  const result = gateway.requests.at(-1)?.messages.findLast((message) => message.role === "toolResult");
  const text = result?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
  return text;
}

it("shrinks a tool result to the application's Tool result size before the model receives it", async () => {
  const small = await readResult({ toolResultChars: 8000 }, 300);
  expect(small.length).toBeLessThanOrEqual(8000);
  expect(small).toContain('"truncated":true');
  // The default leaves a result of about 24000 characters whole.
  expect((await readResult({}, 300)).includes("line 299")).toBe(true);
});

it("lets a raised Tool result size and read output size reach the model uncut", async () => {
  // About 60000 characters: above the default 30000 read output and the 32000 result cut.
  const raised = await readResult({ toolResultChars: 80000, readChars: 70000 }, 760);
  expect(raised.length).toBeGreaterThan(32000);
  expect(raised.includes("line 759")).toBe(true);
  expect((await readResult({}, 760)).length).toBeLessThanOrEqual(32000);
});
