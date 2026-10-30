import { expect, it } from "vitest";
import { channels, defaultSettings, webAccessSnapshotSchema } from "./index.js";

it("defaults to anonymous enabled Exa and rejects bypassing the dedicated preferences boundary", () => {
  expect(defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19").webAccess).toEqual({
    enabled: true,
    provider: "exa",
    authentication: "anonymous",
  });
  expect(channels["app.settings.update"].request.safeParse({ webAccess: { enabled: false } }).success).toBe(
    false,
  );
  expect(
    channels["web.access.save"].request.safeParse({
      enabled: true,
      provider: "exa",
      authentication: "anonymous",
      apiKey: "not-anonymous",
    }).success,
  ).toBe(false);
  expect(
    channels["web.access.save"].request.safeParse({
      enabled: true,
      provider: "exa",
      authentication: "api-key",
      apiKey: "header\ninjection",
    }).success,
  ).toBe(false);
  expect(
    webAccessSnapshotSchema.safeParse({
      preferences: { enabled: true, provider: "exa", authentication: "anonymous" },
      keyConfigured: false,
      storage: null,
      secureStorage: true,
      readOnly: false,
      apiKey: "secret",
    }).success,
  ).toBe(false);
});

it("validates provider-specific authentication and requires provider-scoped test/removal", () => {
  for (const provider of ["exa", "tavily", "brave"]) {
    expect(
      channels["web.access.save"].request.safeParse({ enabled: true, provider, authentication: "api-key" })
        .success,
    ).toBe(true);
    expect(
      channels["web.access.save"].request.safeParse({ enabled: true, provider, authentication: "anonymous" })
        .success,
    ).toBe(provider !== "brave");
  }
  expect(
    channels["web.access.test"].request.safeParse({
      testId: "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
      provider: "brave",
      authentication: "anonymous",
    }).success,
  ).toBe(false);
  expect(channels["web.access.removeKey"].request.safeParse({}).success).toBe(false);
});
