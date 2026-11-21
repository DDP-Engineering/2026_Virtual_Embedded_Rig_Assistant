// REQ-FUNC-52e97b95 REQ-REL-11f00fcd REQ-REL-1b33797f REQ-FUNC-56f63014 REQ-FUNC-33cd5f9f
import type { TurnCapacity, VeraError } from "@vera/shared";

/** One admitted turn's place under the limit. Releasing it more than once has no further effect. */
export interface TurnSlot {
  release(): void;
}

/**
 * Admission of new turns, shared by every SessionService of a host that bounds concurrent turns. `acquire`
 * checks and takes a slot in one synchronous step, so starts that arrive together never exceed the limit.
 */
export interface TurnAdmission {
  /** A slot for one new turn, or undefined when the limit is reached. */
  acquire(): TurnSlot | undefined;
  /** Turns admitted and not yet released, and the limit that admits new ones now. */
  state(): TurnCapacity;
}

/** The refusal of a new turn at the limit. */
export function turnLimitError(limit: number): VeraError {
  return { code: "TURN_LIMIT", messageKey: "errors.TURN_LIMIT", params: { limit } };
}

/**
 * Counts admitted turns against a limit read at every admission, so a changed limit applies to later
 * turns only and turns already admitted keep their slots. `changed` hears every acquire, every first
 * release and every limit change that `refresh` finds; an observer's error never affects the count.
 */
export class TurnLimit implements TurnAdmission {
  private active = 0;
  private announced: number | undefined;
  constructor(
    private readonly options: {
      limit: () => number;
      changed?: (state: TurnCapacity) => void;
    },
  ) {}
  state(): TurnCapacity {
    return { active: this.active, limit: this.options.limit() };
  }
  acquire(): TurnSlot | undefined {
    if (this.active >= this.options.limit()) return undefined;
    this.active++;
    this.notify();
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active--;
        this.notify();
      },
    };
  }
  /** Announce the limit when it differs from the one last announced, such as after a settings save. */
  refresh(): void {
    try {
      if (this.options.limit() === this.announced) return;
    } catch {
      return;
    }
    this.notify();
  }
  /** Never throws: a failing limit read or observer leaves the count, and the caller's cleanup, intact. */
  private notify(): void {
    try {
      const state = this.state();
      this.announced = state.limit;
      this.options.changed?.(state);
    } catch {
      /* an announcement is best effort */
    }
  }
}
