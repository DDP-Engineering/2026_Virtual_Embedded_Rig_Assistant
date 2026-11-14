// REQ-FUNC-f250eee7, REQ-FUNC-fb24a0e4
import { expect, it } from "vitest";
import { MemoryCredentials } from "./host-ports.js";
import { cliProgramCredentials, pluginCredentialsFromEnvironment } from "./plugin-credentials-env.js";

it("holds MQTT credentials from the environment in memory and registers them as secrets", async () => {
  const registered: string[] = [];
  const store = new MemoryCredentials((secret) => registered.push(secret));
  const refs = await pluginCredentialsFromEnvironment(
    {
      VERA_MQTT_PASSWORD_BENCH_1: "bench-password-1",
      VERA_MQTT_USERNAME_BENCH_1: "bench-user",
      VERA_MQTT_USERNAME_ONLY: "no-password-user",
      VERA_MQTT_PASSWORD_LAB: "lab-password",
    },
    store,
    (secret) => registered.push(secret),
  );
  expect(refs).toEqual(["mqtt:bench-1", "mqtt:lab"]);
  expect(registered).toEqual(expect.arrayContaining(["bench-password-1", "bench-user", "lab-password"]));
  const port = cliProgramCredentials(store);
  expect(await port.read("mqtt", "bench-1")).toEqual({
    username: "bench-user",
    password: "bench-password-1",
  });
  expect(await port.read("mqtt", "lab")).toEqual({ password: "lab-password" });
  expect(await port.has("mqtt", "only")).toBe(false);
});

it("refuses a password with a control character", async () => {
  const store = new MemoryCredentials(() => {});
  await expect(
    pluginCredentialsFromEnvironment({ VERA_MQTT_PASSWORD_X: "a\nb" }, store, () => {}),
  ).rejects.toMatchObject({
    code: "INVALID",
  });
});

it("holds Wokwi tokens from the environment in memory under wokwi:<ref>", async () => {
  const registered: string[] = [];
  const store = new MemoryCredentials((secret) => registered.push(secret));
  const ids = await pluginCredentialsFromEnvironment(
    {
      VERA_WOKWI_TOKEN_BENCH_1: "wokwi-token-1",
      VERA_WOKWI_TOKEN_EMPTY: "",
      VERA_MQTT_PASSWORD_BENCH_1: "pw",
    },
    store,
    (secret) => registered.push(secret),
  );
  expect(ids).toEqual(["mqtt:bench-1", "wokwi:bench-1"]);
  expect(registered).toContain("wokwi-token-1");
  const port = cliProgramCredentials(store);
  expect(await port.read("wokwi", "bench-1")).toEqual({ password: "wokwi-token-1" });
  expect(await port.has("wokwi", "empty")).toBe(false);
  expect(await port.read("mqtt", "bench-1")).toEqual({ password: "pw" });
  await expect(
    pluginCredentialsFromEnvironment({ VERA_WOKWI_TOKEN_X: "ab" }, new MemoryCredentials(() => {}), () => {}),
  ).rejects.toMatchObject({ code: "INVALID" });
});
