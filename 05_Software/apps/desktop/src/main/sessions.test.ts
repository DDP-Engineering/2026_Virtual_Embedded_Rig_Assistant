import { expect, it } from "vitest";
import { SessionsHost } from "./sessions.js";

it("denies foreign and detached subscription frames and malformed requests before core setup", async () => {
  const frame = { url: "vera://app/index.html" };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  let destroyed = false;
  const target = { webContents: { ...contents, isDestroyed: () => destroyed }, url: frame.url };
  const host = new SessionsHost({
    target: () => target,
    workbench: {
      getSnapshot: () => {
        throw Error("must not dispatch");
      },
    },
  } as never);
  const payload = { sessionId: "ses_01J00000000000000000000000", sinceSeq: 0, subscriptionId: "s" };
  expect(
    await host.subscription({ sender: contents, senderFrame: frame }, "subscribe", payload),
  ).toMatchObject({ ok: false, error: { code: "DENIED" } });
  expect(
    await host.subscription({ sender: target.webContents, senderFrame: null }, "subscribe", payload),
  ).toMatchObject({ ok: false, error: { code: "DENIED" } });
  expect(
    await host.subscription({ sender: target.webContents, senderFrame: frame }, "subscribe", {
      ...payload,
      sinceSeq: -1,
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID" } });
  destroyed = true;
  expect(
    await host.subscription({ sender: target.webContents, senderFrame: frame }, "subscribe", payload),
  ).toMatchObject({ ok: false, error: { code: "DENIED" } });
});
