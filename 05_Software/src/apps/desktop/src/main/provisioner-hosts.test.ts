import type { PluginStore, Provisioner } from "@vera/core";
import { expect, it, vi } from "vitest";
import { ProvisionerHosts } from "./provisioner-hosts.js";

// REQ-FUNC-ed2e8564
it("shares overlapping scoped operations but never a different workbench or completed host", async () => {
  const drains = vi.fn(async () => {});
  const create = vi.fn(() => ({ drain: drains }) as unknown as Provisioner);
  const hosts = new ProvisionerHosts(create);
  const store = (scopeKey: string) => ({ scopeKey }) as PluginStore;
  let release = () => {},
    entered = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let first: Provisioner | undefined;
  const pending = hosts.run(store("A"), async (host) => {
    first = host;
    entered();
    await held;
    return host;
  });
  await started;
  expect(await hosts.run(store("A"), async (host) => host)).toBe(first);
  expect(await hosts.run(store("B"), async (host) => host)).not.toBe(first);
  release();
  await pending;
  expect(await hosts.run(store("A"), async (host) => host)).not.toBe(first);
  await hosts.close();
  await expect(hosts.run(store("A"), async () => {})).rejects.toMatchObject({ code: "BUSY" });
  expect(create).toHaveBeenCalledTimes(3);
  expect(drains).toHaveBeenCalledTimes(3);
});
