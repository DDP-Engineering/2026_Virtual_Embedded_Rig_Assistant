import { expect, it } from "vitest";
import { drainShutdown } from "./shutdown.js";

it("runs every step in order and reports a clean drain", async () => {
  const ran: string[] = [];
  const step = (name: string) => [name, async () => void ran.push(name)] as const;
  expect(await drainShutdown([step("a"), step("b")], [step("c"), step("d")], () => ran.push("failed"))).toBe(
    true,
  );
  expect(ran).toEqual(["a", "b", "c", "d"]);
});

it("keeps running the remaining steps after a rejected or throwing step and reports each failure", async () => {
  const ran: string[] = [];
  const failed: string[] = [];
  const step = (name: string) => [name, async () => void ran.push(name)] as const;
  const clean = await drainShutdown(
    [["programs", () => Promise.reject(Error("still running"))], step("terminals")],
    [
      step("sessions"),
      [
        "workbench",
        () => {
          throw Error("locked");
        },
      ],
      step("settings"),
      step("log"),
    ],
    (name) => failed.push(name),
  );
  expect(clean).toBe(false);
  expect(ran).toEqual(["terminals", "sessions", "settings", "log"]);
  expect(failed).toEqual(["programs", "workbench"]);
});
