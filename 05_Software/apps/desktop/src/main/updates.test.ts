import type { AppEvent, UpdateMode, UpdateOffer } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { Updates } from "./updates.js";

const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
  vi.useRealTimers();
});
const offer: UpdateOffer = {
  version: "0.0.1",
  notes: "<b>plain notes</b>",
  link: "https://feed.test/VERA.exe",
};
function setup(distribution: "installed" | "portable" | "managed" = "installed") {
  let mode: UpdateMode = "notify";
  let channel: "latest" | "beta" = "latest";
  let busy = false;
  const events: AppEvent[] = [];
  const check = vi.fn(async () => offer);
  const download = vi.fn(async (progress: (v: number) => void) => {
    progress(40);
  });
  const install = vi.fn(),
    quit = vi.fn(),
    openExternal = vi.fn(async () => {});
  const u = new Updates({
    distribution,
    configured: true,
    backend: { check, download, install },
    preferences: () => ({ mode, channel }),
    emit: (e) => events.push(e),
    beginShutdown: () => !busy,
    quit,
    openExternal,
  });
  closes.push(() => u.close());
  return {
    u,
    check,
    download,
    install,
    quit,
    events,
    openExternal,
    mode: (v: UpdateMode) => {
      mode = v;
    },
    channel: (v: "latest" | "beta") => {
      channel = v;
    },
    busy: (v: boolean) => {
      busy = v;
    },
  };
}
it("checks startup and six hours only when enabled; Check now works in Off", async () => {
  vi.useFakeTimers();
  const h = setup();
  h.mode("off");
  h.u.start();
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
  expect(h.check).not.toHaveBeenCalled();
  await h.u.check();
  expect(h.check).toHaveBeenCalledTimes(1);
  expect(h.download).not.toHaveBeenCalled();
  h.mode("notify");
  h.u.settingsChanged();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.check).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
  expect(h.check).toHaveBeenCalledTimes(3);
  h.mode("off");
  h.u.settingsChanged();
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
  expect(h.check).toHaveBeenCalledTimes(3);
});
it("keeps the six-hour deadline through unrelated settings notifications", async () => {
  vi.useFakeTimers();
  const h = setup();
  h.u.start();
  await vi.advanceTimersByTimeAsync(0);
  for (let hour = 0; hour < 6; hour++) {
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    h.u.settingsChanged();
  }
  expect(h.check).toHaveBeenCalledTimes(2);
});
it("downloads only with consent or automatic mode and pins ready payload", async () => {
  const h = setup();
  await h.u.check();
  expect(h.u.get()).toMatchObject({ phase: "available", offer });
  expect(h.events).toContainEqual({ type: "update.available", version: offer.version, notes: offer.notes });
  expect(h.download).not.toHaveBeenCalled();
  await h.u.download();
  expect(h.u.get()).toMatchObject({ phase: "ready", progress: 100 });
  h.channel("beta");
  await h.u.check();
  expect(h.check).toHaveBeenCalledTimes(1);
  const auto = setup();
  auto.mode("download");
  await auto.u.check();
  expect(auto.download).toHaveBeenCalledTimes(1);
});
it("never downloads or installs portable/deb; current portable link requires version confirmation", async () => {
  for (const distribution of ["portable", "managed"] as const) {
    const h = setup(distribution);
    h.mode("download");
    await h.u.check();
    expect(h.u.get().phase).toBe("available");
    expect(h.download).not.toHaveBeenCalled();
    await expect(h.u.download()).rejects.toMatchObject({ code: "DENIED" });
    expect(() => h.u.requestRestart()).toThrow(expect.objectContaining({ code: "DENIED" }));
    h.u.requestQuit();
    expect(h.install).not.toHaveBeenCalled();
    await expect(h.u.openRelease("wrong")).rejects.toMatchObject({ code: "DENIED" });
    if (distribution === "portable") {
      await h.u.openRelease(offer.version);
      expect(h.openExternal).toHaveBeenCalledWith(offer.link);
    } else await expect(h.u.openRelease(offer.version)).rejects.toMatchObject({ code: "DENIED" });
  }
});
it.each([true, false])(
  "defers restart=%s without abort until host atomically admits shutdown",
  async (restart) => {
    vi.useFakeTimers();
    const h = setup();
    await h.u.check();
    await h.u.download();
    h.busy(true);
    if (restart) expect(h.u.requestRestart().phase).toBe("deferred");
    else h.u.requestQuit();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.quit).not.toHaveBeenCalled();
    expect(h.u.finishShutdown()).toBe(false);
    h.busy(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.quit).toHaveBeenCalledTimes(1);
    expect(h.install).not.toHaveBeenCalled();
    expect(h.u.finishShutdown()).toBe(true);
    expect(h.install).toHaveBeenCalledWith(restart);
    expect(h.u.finishShutdown()).toBe(false);
    await expect(h.u.check()).rejects.toMatchObject({ code: "DENIED" });
  },
);
it("keeps failed checks/downloads recoverable and never ready after integrity failure", async () => {
  const h = setup();
  h.check.mockRejectedValueOnce(Error("private path/token"));
  expect(await h.u.check()).toMatchObject({ phase: "error", errorCode: "NETWORK", offer: null });
  await h.u.check();
  h.download.mockRejectedValueOnce(
    Object.assign(Error("private path"), { code: "ERR_UPDATER_INVALID_SIGNATURE" }),
  );
  expect(await h.u.download()).toMatchObject({ phase: "error", errorCode: "INTEGRITY" });
  expect(h.u.hasDownloaded).toBe(false);
  expect(JSON.stringify(h.events)).not.toContain("private");
  await h.u.check();
  await h.u.download();
  expect(h.u.get().phase).toBe("ready");
});
