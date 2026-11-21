import { describe, expect, it, vi } from "vitest";
import { TurnLimit, turnLimitError } from "./admission.js";

describe("TurnLimit", () => {
  // REQ-REL-1b33797f
  it("admits up to the limit and refuses the next start", () => {
    const limit = new TurnLimit({ limit: () => 2 });
    const first = limit.acquire();
    const second = limit.acquire();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(limit.acquire()).toBeUndefined();
    expect(limit.state()).toEqual({ active: 2, limit: 2 });
  });

  // REQ-REL-11f00fcd
  it("releases a slot once, however often release is called", () => {
    const limit = new TurnLimit({ limit: () => 1 });
    const slot = limit.acquire();
    slot?.release();
    slot?.release();
    expect(limit.state()).toEqual({ active: 0, limit: 1 });
    const next = limit.acquire();
    expect(next).toBeDefined();
    slot?.release();
    expect(limit.state().active).toBe(1);
    expect(limit.acquire()).toBeUndefined();
  });

  // REQ-FUNC-56f63014
  it("applies a lowered limit to later admissions and keeps admitted slots", () => {
    let value = 3;
    const limit = new TurnLimit({ limit: () => value });
    const slots = [limit.acquire(), limit.acquire(), limit.acquire()];
    value = 1;
    expect(limit.state()).toEqual({ active: 3, limit: 1 });
    expect(limit.acquire()).toBeUndefined();
    slots[0]?.release();
    slots[1]?.release();
    expect(limit.acquire()).toBeUndefined();
    slots[2]?.release();
    expect(limit.acquire()).toBeDefined();
  });

  // REQ-FUNC-33cd5f9f
  it("notifies every acquire, release and changed limit with both values", () => {
    let value = 3;
    const changed = vi.fn();
    const limit = new TurnLimit({ limit: () => value, changed });
    const slot = limit.acquire();
    expect(changed).toHaveBeenLastCalledWith({ active: 1, limit: 3 });
    limit.refresh();
    expect(changed).toHaveBeenCalledTimes(1);
    value = 5;
    limit.refresh();
    expect(changed).toHaveBeenLastCalledWith({ active: 1, limit: 5 });
    slot?.release();
    slot?.release();
    expect(changed).toHaveBeenLastCalledWith({ active: 0, limit: 5 });
    expect(changed).toHaveBeenCalledTimes(3);
    value = 1;
    limit.acquire();
    limit.acquire();
    expect(changed).toHaveBeenCalledTimes(4);
  });

  // REQ-REL-11f00fcd
  it("keeps counting when an observer throws", () => {
    const limit = new TurnLimit({
      limit: () => 1,
      changed: () => {
        throw Error("observer");
      },
    });
    const slot = limit.acquire();
    expect(slot).toBeDefined();
    slot?.release();
    expect(limit.state().active).toBe(0);
  });

  // REQ-REL-11f00fcd
  it("releases without throwing when the limit cannot be read", () => {
    let unreadable = false;
    const limit = new TurnLimit({
      limit: () => {
        if (unreadable) throw Error("settings unavailable");
        return 1;
      },
      changed: () => {},
    });
    const slot = limit.acquire();
    unreadable = true;
    expect(() => slot?.release()).not.toThrow();
    expect(() => limit.refresh()).not.toThrow();
    unreadable = false;
    expect(limit.state()).toEqual({ active: 0, limit: 1 });
  });

  // REQ-FUNC-52e97b95
  it("describes the refusal as TURN_LIMIT with the limit", () => {
    expect(turnLimitError(3)).toEqual({
      code: "TURN_LIMIT",
      messageKey: "errors.TURN_LIMIT",
      params: { limit: 3 },
    });
  });
});
