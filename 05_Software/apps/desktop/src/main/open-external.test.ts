import { expect, it, vi } from "vitest";
import { openExternal } from "./open-external.js";

it("opens only confirmed HTTP(S) and confines subscription authorization to the pinned OpenAI page", async () => {
  const open = vi.fn(async () => {});
  await openExternal(
    { url: "https://auth.openai.com/api/accounts/authorize?state=fake", confirmed: true },
    open,
    true,
  );
  expect(open).toHaveBeenCalledOnce();
  for (const url of [
    "https://evil.invalid/api/accounts/authorize",
    "https://auth.openai.com.evil.invalid/api/accounts/authorize",
    "https://user:pass@auth.openai.com/api/accounts/authorize",
    "https://auth.openai.com:8080/api/accounts/authorize",
    "https://auth.openai.com/oauth/authorize",
  ]) {
    await expect(openExternal({ url, confirmed: true }, open, true)).rejects.toMatchObject({
      code: "DENIED",
    });
  }
  expect(open).toHaveBeenCalledOnce();
  await expect(openExternal({ url: "file:///tmp/secret", confirmed: true }, open)).rejects.toMatchObject({
    code: "INVALID",
  });
});
