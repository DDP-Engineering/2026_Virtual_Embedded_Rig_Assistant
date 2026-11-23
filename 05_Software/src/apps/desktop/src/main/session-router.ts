import type { SessionService, WorkbenchService } from "@vera/core";
import {
  type SessionSummary,
  sessionSubscriptionSchema,
  veraError,
  veraErrorSchema,
  type WorkbenchSnapshot,
} from "@vera/shared";
import type { InvokeSender } from "./ipc-router.js";
import type { RunPreparation, SessionsHost } from "./sessions.js";

type Database = ReturnType<WorkbenchService["getDatabase"]>;
type SubscriptionResult = Awaited<ReturnType<SessionsHost["subscription"]>>;

/** What routing needs of a workbench runtime: its open workbench and its session host. */
export interface RoutedRuntime {
  readonly workbench: Pick<WorkbenchService, "getSnapshot" | "getDatabase">;
  readonly sessions: Pick<
    SessionsHost,
    "run" | "subscription" | "holdsSubscription" | "authorized" | "activity"
  >;
}

/** A runtime and the workbench it had open when a request was routed to it. */
export interface SessionRoute<R extends RoutedRuntime> {
  readonly runtime: R;
  readonly snapshot: WorkbenchSnapshot;
  readonly db: Database;
}

/** One open workbench runtime and its sessions that are running or awaiting approval. */
export interface RuntimeActivity {
  readonly snapshot: WorkbenchSnapshot;
  readonly foreground: boolean;
  readonly sessions: SessionSummary[];
}

const membership = new WeakMap<Database, { get(id: string): unknown }>();
/** Membership in one exact workbench database. */
export function holdsSession(db: Database, sessionId: string): boolean {
  if (!db.open) return false;
  let statement = membership.get(db);
  if (!statement) {
    statement = db.prepare("SELECT 1 FROM sessions WHERE id=?");
    membership.set(db, statement);
  }
  return statement.get(sessionId) !== undefined;
}

/** The runtime's open workbench and database; undefined while it has none open. */
function opened<R extends RoutedRuntime>(runtime: R): SessionRoute<R> | undefined {
  try {
    const db = runtime.workbench.getDatabase();
    if (!db.open) return undefined;
    return { runtime, snapshot: runtime.workbench.getSnapshot(), db };
  } catch {
    return undefined;
  }
}

function failure(error: unknown): SubscriptionResult {
  const known = veraErrorSchema.safeParse(error);
  return { ok: false, error: known.success ? known.data : veraError("INTERNAL") };
}

/**
 * Sends each session request to the workbench runtime that owns it, whichever workbench is in the
 * foreground: a request naming a session goes to the open runtime whose database holds that session, and a
 * request naming a workbench goes to the open runtime with that ID. Runtimes are searched foreground first,
 * so when a copied folder and its original both hold a session, the shown one wins.
 */
export class SessionRouter<R extends RoutedRuntime> {
  constructor(
    /** The open runtimes, foreground first. */
    private readonly runtimes: () => readonly R[],
  ) {}
  private open(): SessionRoute<R>[] {
    return this.runtimes()
      .map((runtime) => opened(runtime))
      .filter((route) => route !== undefined);
  }
  /**
   * The runtime holding `sessionId`, which must have `workbenchId` when one is named. NOT_FOUND when no
   * open workbench holds the session; CONFLICT when the named workbench is not open or does not hold it.
   */
  session(sessionId: string, workbenchId?: string): SessionRoute<R> {
    const open = this.open();
    const holders = open.filter((route) => holdsSession(route.db, sessionId));
    if (workbenchId === undefined) {
      const owner = holders[0];
      if (!owner) throw veraError("NOT_FOUND");
      return owner;
    }
    const named = holders.find((route) => route.snapshot.config.id === workbenchId);
    if (named) return named;
    if (holders.length || (open.length && !open.some((route) => route.snapshot.config.id === workbenchId)))
      throw veraError("CONFLICT");
    throw veraError("NOT_FOUND");
  }
  /**
   * The open runtime with `workbenchId`, foreground first; without an ID, the foreground. NOT_FOUND while no
   * workbench is open; CONFLICT when the named workbench is not open.
   */
  workbench(workbenchId?: string): SessionRoute<R> {
    const open = this.open();
    if (!open.length) throw veraError("NOT_FOUND");
    if (workbenchId === undefined) {
      const foreground = this.runtimes()[0];
      const shown = open.find((route) => route.runtime === foreground);
      if (!shown) throw veraError("NOT_FOUND");
      return shown;
    }
    const named = open.find((route) => route.snapshot.config.id === workbenchId);
    if (!named) throw veraError("CONFLICT");
    return named;
  }
  /** The routed runtime's current snapshot, when it still has the same workbench open; CONFLICT otherwise. */
  verify(route: SessionRoute<R>): WorkbenchSnapshot {
    const now = opened(route.runtime);
    if (
      !now ||
      now.db !== route.db ||
      now.snapshot.config.id !== route.snapshot.config.id ||
      now.snapshot.folder !== route.snapshot.folder
    )
      throw veraError("CONFLICT");
    return now.snapshot;
  }
  /** Runs on the routed runtime's session host once its queued slot comes, if its workbench is unchanged. */
  run<T>(
    route: SessionRoute<R>,
    operation: (service: SessionService, owner: WorkbenchSnapshot) => T | Promise<T>,
    preparation: RunPreparation = {},
  ): Promise<T> {
    let owner = route.snapshot;
    return route.runtime.sessions.run(
      (service) => operation(service, owner),
      preparation,
      () => {
        owner = this.verify(route);
      },
    );
  }
  /** Routes by session, then runs; see session() for the refusals. */
  async inSession<T>(
    sessionId: string,
    operation: (service: SessionService, owner: WorkbenchSnapshot) => T | Promise<T>,
    preparation: RunPreparation = {},
    workbenchId?: string,
  ): Promise<T> {
    return this.run(this.session(sessionId, workbenchId), operation, preparation);
  }
  /** Routes by workbench, then runs; see workbench() for the refusals. */
  async inWorkbench<T>(
    workbenchId: string | undefined,
    operation: (service: SessionService, owner: WorkbenchSnapshot) => T | Promise<T>,
    preparation: RunPreparation = {},
  ): Promise<T> {
    return this.run(this.workbench(workbenchId), operation, preparation);
  }
  /**
   * Session subscription control. A subscription opens in the runtime that holds its session and stays
   * there across foreground changes; unsubscribe reaches every runtime, and each ends only its own.
   */
  async subscription(event: InvokeSender, action: unknown, raw: unknown): Promise<SubscriptionResult> {
    const runtimes = this.runtimes();
    const foreground = runtimes[0];
    if (!foreground?.sessions.authorized(event)) return { ok: false, error: veraError("DENIED") };
    if (action !== "subscribe") {
      const results = await Promise.all(
        runtimes.map((runtime) => runtime.sessions.subscription(event, action, raw)),
      );
      return results.find((result) => !result.ok) ?? results[0] ?? failure(veraError("INTERNAL"));
    }
    const parsed = sessionSubscriptionSchema.safeParse(raw);
    if (!parsed.success) return foreground.sessions.subscription(event, action, raw);
    try {
      const { subscriptionId, sessionId } = parsed.data;
      if (runtimes.some((runtime) => runtime.sessions.holdsSubscription(subscriptionId)))
        throw veraError("CONFLICT");
      const route = this.session(sessionId);
      return await route.runtime.sessions.subscription(event, action, raw, () => {
        this.verify(route);
      });
    } catch (error) {
      return failure(error);
    }
  }
  /** Every open runtime, foreground first, with its top-level sessions running or awaiting approval. */
  async activity(): Promise<RuntimeActivity[]> {
    const foreground = this.runtimes()[0];
    return Promise.all(
      this.open().map(async (route) => {
        let sessions: SessionSummary[] = [];
        try {
          sessions = await route.runtime.sessions.activity();
        } catch {
          /* a runtime closing meanwhile shows no sessions */
        }
        return { snapshot: route.snapshot, foreground: route.runtime === foreground, sessions };
      }),
    );
  }
}
