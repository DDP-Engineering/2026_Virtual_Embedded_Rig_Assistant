// REQ-FUNC-f250eee7, REQ-FUNC-fb24a0e4
import { expect, it } from "vitest";
import { ConsoleLogger, MemoryCredentials } from "./host-ports.js";
import { cliProgramCredentials, pluginCredentialsFromEnvironment } from "./plugin-credentials-env.js";

it("hands off the MQTT username privately and masks only the password in diagnostics", async () => {
  const lines: string[] = [];
  const logger = new ConsoleLogger((line) => lines.push(line));
  const register = (secret: string) => logger.registerSecret(secret);
  const store = new MemoryCredentials(register);
  const password = 'bench-password-1"\\canary';
  const refs = await pluginCredentialsFromEnvironment(
    {
      VERA_MQTT_PASSWORD_BENCH_1: password,
      VERA_MQTT_USERNAME_BENCH_1: "pi",
      VERA_MQTT_USERNAME_ONLY: "no-password-user",
      VERA_MQTT_PASSWORD_LAB: "lab-password",
    },
    store,
    register,
  );
  expect(refs).toEqual(["mqtt:bench-1", "mqtt:lab"]);
  expect(logger.knownSecrets().sort()).toEqual([password, "lab-password"]);
  logger.log("error", `pin ${password}`);
  expect(lines.map((line) => JSON.parse(line))).toEqual([{ level: "error", message: "pin [REDACTED]" }]);
  const port = cliProgramCredentials(store);
  expect(await port.read("mqtt", "bench-1")).toEqual({
    username: "pi",
    password,
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
