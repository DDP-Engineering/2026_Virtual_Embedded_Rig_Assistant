// REQ-FUNC-f250eee7
import { expect, it } from "vitest";
import { MemoryCredentials } from "./host-ports.js";
import { cliProgramCredentials, mqttFromEnvironment } from "./mqtt-env.js";

it("holds MQTT credentials from the environment in memory and registers them as secrets", async () => {
  const registered: string[] = [];
  const store = new MemoryCredentials((secret) => registered.push(secret));
  const refs = await mqttFromEnvironment(
    {
      VERA_MQTT_PASSWORD_BENCH_1: "bench-password-1",
      VERA_MQTT_USERNAME_BENCH_1: "bench-user",
      VERA_MQTT_USERNAME_ONLY: "no-password-user",
      VERA_MQTT_PASSWORD_LAB: "lab-password",
    },
    store,
    (secret) => registered.push(secret),
  );
  expect(refs).toEqual(["bench-1", "lab"]);
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
  await expect(mqttFromEnvironment({ VERA_MQTT_PASSWORD_X: "a\nb" }, store, () => {})).rejects.toMatchObject({
    code: "INVALID",
  });
});
