import type { GitStatusOwner } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import type { readStatus } from "./status.js";
import { GitStatusService } from "./status-service.js";

const first: GitStatusOwner = {
  workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  indexLease: 1,
  viewId: "c8518406-3a25-4ad6-b11d-20ca0197b0cf",
};
const other = { ...first, indexLease: 2, viewId: "1b1c5f30-1f61-4a39-b609-9a30ca250b68" };
const absent = { status: { state: "no-repository" as const } };
const failed = { status: { state: "failed" as const } };

function fixture() {
  let active = { workbenchId: first.workbenchId, indexLease: 1, folder: "/old", enabled: true };
  const scope = () => active;
  const read = vi.fn(async (_scope: string, _signal: AbortSignal): ReturnType<typeof readStatus> => absent);
  const publish = vi.fn();
  const close = vi.fn();
  const watch = vi.fn((_scope: string, _change: () => void, _error: () => void) => ({
    close,
    sync: vi.fn(async () => ({ limited: false, added: false })),
  }));
  const service = new GitStatusService({ scope, read, publish, watch });
  return {
    service,
    read,
    publish,
    watch,
    close,
    swap: () => {
      active = { ...active, indexLease: 2, folder: "/copy" };
      service.reconcile();
    },
  };
}
afterEach(() => vi.useRealTimers());

// REQ-REL-92f883f5
it("debounces changes, coalesces manual refresh with an active read and suppresses unchanged events", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.service.request({ ...first, action: "open" });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.read).toHaveBeenCalledTimes(1);
  const changed = f.watch.mock.calls[0]![1];
  changed();
  changed();
  await vi.advanceTimersByTimeAsync(150);
  changed();
  await vi.advanceTimersByTimeAsync(200);
  expect(f.read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(300);
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.publish).toHaveBeenCalledTimes(1);
  f.read.mockResolvedValueOnce(failed);
  f.service.request({ ...first, action: "refresh" });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.read).toHaveBeenCalledTimes(3);
  expect(f.publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: failed.status }));
  f.service.request({ ...first, action: "close" });
  expect(f.close).toHaveBeenCalledTimes(1);
});

it("reconciles after adding watch coverage before publishing a baseline", async () => {
  const f = fixture();
  f.watch.mockReturnValueOnce({
    close: f.close,
    sync: vi
      .fn()
      .mockResolvedValueOnce({ limited: false, added: true })
      .mockResolvedValue({ limited: false, added: false }),
  });
  f.read
    .mockResolvedValueOnce({
      status: {
        state: "ready",
        branch: { kind: "named", name: "before" },
        changed: 0,
        conflicts: 0,
        entries: [],
      },
    })
    .mockResolvedValueOnce(failed);
  f.service.request({ ...first, action: "open" });
  await vi.waitFor(() => expect(f.publish).toHaveBeenCalledOnce());
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: failed.status }));
  f.service.stop();
});

it("cancels stale work and never publishes it into an activation with the same workbench ID", async () => {
  const f = fixture();
  let finish!: (answer: typeof failed) => void;
  f.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.service.request({ ...first, action: "open" });
  const signal = f.read.mock.calls[0]![1];
  f.swap();
  expect(signal.aborted).toBe(true);
  expect(f.close).toHaveBeenCalledTimes(1);
  f.service.request({ ...other, action: "open" });
  f.service.request({ ...first, action: "close" });
  finish(failed);
  await vi.waitFor(() => expect(f.publish).toHaveBeenCalledTimes(1));
  expect(f.publish.mock.calls[0]?.[0]).toMatchObject({ ...other, status: absent.status });
  expect(f.read.mock.calls.map(([scope]) => scope)).toEqual(["/old", "/copy"]);
  expect(() => f.service.request({ ...first, action: "refresh" })).toThrow();
  f.service.stop();
});
