// REQ-REL-3cbc93f2 REQ-REL-92f883f5
import {
  type GitStatus,
  type GitStatusOwner,
  type GitStatusUpdate,
  gitStatusSchema,
  type Request,
  veraError,
} from "@vera/shared";
import type { readStatus } from "./status.js";
import type { GitWatch } from "./watch.js";

type Scope = Omit<GitStatusOwner, "viewId"> & { folder: string; enabled: boolean };
type Watch = Pick<GitWatch, "sync" | "close">;
type View = {
  owner: GitStatusOwner;
  folder: string;
  controller: AbortController;
  watch: Watch;
  timer?: ReturnType<typeof setTimeout>;
  firstChange: number | undefined;
  busy: boolean;
  pending: boolean;
  watchFault: boolean;
  published: string | undefined;
};

function sameActivation(one: Omit<GitStatusOwner, "viewId">, other: Omit<GitStatusOwner, "viewId">) {
  return one.workbenchId === other.workbenchId && one.indexLease === other.indexLease;
}

const debounceMs = 350;
const maxDelayMs = 1500;

/** Keeps one renderer view, one workbench lease and one Git refresh together. */
export class GitStatusService {
  private view: View | undefined;

  constructor(
    private readonly options: {
      scope: () => Scope | undefined;
      read: (folder: string, signal: AbortSignal) => ReturnType<typeof readStatus>;
      project?: (id: string, status: GitStatus) => GitStatus;
      publish: (update: GitStatusUpdate) => void;
      watch: (folder: string, changed: () => void, error: () => void) => Watch;
    },
  ) {}

  request({ action, ...owner }: Request<"git.status">): void {
    this.reconcile();
    const view = this.view;
    const known = view && sameActivation(view.owner, owner) && view.owner.viewId === owner.viewId;
    if (action === "close") {
      if (known) this.stop();
      return;
    }
    const scope = this.options.scope();
    if (!scope || !sameActivation(scope, owner)) throw veraError("CONFLICT");
    if (!scope.enabled) throw veraError("DENIED");
    if (action === "refresh" && !known) throw veraError("CONFLICT");
    if (known) {
      this.start(view, action === "refresh");
      return;
    }
    this.stop();
    const next: View = {
      owner,
      folder: scope.folder,
      controller: new AbortController(),
      watch: this.options.watch(
        scope.folder,
        () => this.debounce(next),
        () => {
          next.watchFault = true;
          this.debounce(next);
        },
      ),
      firstChange: undefined,
      published: undefined,
      busy: false,
      pending: false,
      watchFault: false,
    };
    this.view = next;
    this.start(next, false);
  }

  reconcile(): void {
    const view = this.view;
    if (!view) return;
    const scope = this.options.scope();
    if (!scope?.enabled || !sameActivation(view.owner, scope) || view.folder !== scope.folder) this.stop();
  }

  stop(): void {
    const view = this.view;
    this.view = undefined;
    if (!view) return;
    clearTimeout(view.timer);
    view.controller.abort();
    view.watch.close();
  }

  private debounce(view: View) {
    if (this.view !== view) return;
    const now = Date.now();
    view.firstChange ??= now;
    clearTimeout(view.timer);
    view.timer = setTimeout(
      () => this.start(view, false),
      Math.max(0, Math.min(debounceMs, view.firstChange + maxDelayMs - now)),
    );
  }

  private start(view: View, forcePublish: boolean) {
    clearTimeout(view.timer);
    view.firstChange = undefined;
    if (forcePublish) view.published = undefined;
    if (view.busy) {
      view.pending = true;
      return;
    }
    view.busy = true;
    void this.refresh(view).finally(() => {
      view.busy = false;
      if (this.view === view && view.pending) {
        view.pending = false;
        this.start(view, false);
      }
    });
  }

  private async refresh(view: View) {
    const signal = view.controller.signal;
    let status: GitStatus = { state: "failed" };
    let watchLimited = true;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await this.options.read(view.folder, signal);
        if (signal.aborted) return;
        status = result.status;
        view.watchFault = false;
        const watch = await view.watch.sync(result, signal);
        watchLimited = watch.limited;
        if (status.state !== "ready" || !watch.added) break;
        // A new watch may have missed a change between the scan and its installation.
        if (attempt === 1) view.pending = true;
      }
    } catch {
      if (signal.aborted) return;
    }
    this.reconcile();
    if (this.view !== view) return;
    try {
      status = gitStatusSchema.parse(this.options.project?.(view.owner.workbenchId, status) ?? status);
    } catch {
      status = { state: "failed" };
    }
    const update = { ...view.owner, status, watchLimited: watchLimited || view.watchFault };
    // Repeated successful reads during a burst should not redraw Files.
    const fingerprint = JSON.stringify(update);
    if (fingerprint === view.published) return;
    view.published = fingerprint;
    try {
      this.options.publish(update);
    } catch {
      // A renderer can disappear between validation and sending its update.
      this.stop();
    }
  }
}
