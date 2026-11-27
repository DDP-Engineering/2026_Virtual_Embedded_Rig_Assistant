// @vitest-environment jsdom
import { type VeraError, veraErrorSchema } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ErrorMessage } from "./error-message.js";
import "../i18n.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
async function shown(error: unknown) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(createElement(ErrorMessage, { error })));
  const alert = container.querySelector("[role=alert]");
  const result = { key: alert?.getAttribute("data-i18n"), text: alert?.textContent };
  await act(async () => root.unmount());
  return result;
}
it.each(veraErrorSchema.shape.code.options)("has its own message for the error code %s", async (code) => {
  const { key, text } = await shown({ code, messageKey: `errors.${code}` } satisfies VeraError);
  expect(key).toBe(`errors.${code}`);
  expect(text).toBeTruthy();
  expect(text).not.toBe(key);
});
it("shows an unknown key by its code, and anything that is not an error as an internal error", async () => {
  expect((await shown({ code: "PROVIDER", messageKey: "provider.someNewKey" })).key).toBe("errors.PROVIDER");
  expect((await shown(new Error("boom"))).key).toBe("errors.INTERNAL");
});

it("distinguishes a provider size refusal from the local file limit", async () => {
  expect(await shown({ code: "PROVIDER", messageKey: "provider.requestTooLarge" })).toMatchObject({
    key: "provider.requestTooLarge",
    text: expect.stringContaining("provider rejected the request because it was too large"),
  });
  expect(
    await shown({ code: "IMAGE_TOO_LARGE", messageKey: "errors.IMAGE_TOO_LARGE", params: { maxMB: 41 } }),
  ).toMatchObject({ text: "An image can be at most 41 MiB." });
});
