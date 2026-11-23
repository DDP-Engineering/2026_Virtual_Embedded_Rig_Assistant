import { randomUUID } from "node:crypto";
import type { LiveSessionActivity } from "@vera/core";
import { type HelpLanguage, type Settings, sessionIdSchema, workbenchIdSchema } from "@vera/shared";
import type { NotificationConstructorOptions } from "electron";
import { notificationOptions } from "./session-notification-copy.js";

type Workbench = { folder: string; config: { id: string } };
type NativeNotice = {
  on(event: "show" | "click" | "close" | "failed", listener: () => void): unknown;
  show(): void;
  close(): void;
};

export interface NotificationTarget {
  folder: string;
  workbenchId: string;
  sessionId: string;
  approvalPending?: () => boolean;
}

/** Delivers live session alerts and hands out a target only after a click on the OS notification. */
export class SessionNotifications {
  private readonly seen = new Set<string>();
  private readonly approvals = new Map<string, () => void>();
  // Electron can keep Windows notifications in Action Center after the banner has timed out.
  private readonly live = new Set<NativeNotice>();
  private activation?: { token: string; key: string; target: NotificationTarget } | undefined;
  constructor(
    private readonly host: {
      platform: string;
      portable: boolean;
      preferences: () => Settings["notifications"];
      language: () => HelpLanguage;
      window: () => { minimized: boolean; visible: boolean; focused: boolean } | undefined;
      supported: () => boolean;
      create: (options: NotificationConstructorOptions) => NativeNotice;
      activate: (token: string) => void;
      failed: () => void;
    },
  ) {}

  observe(workbench: Workbench, sessionId: string, event: LiveSessionActivity): void {
    // Even Electron's capability query can register a persistent Windows toast activator.
    if (this.host.platform === "win32" && this.host.portable) return;
    const workbenchId = workbench.config.id;
    if (!workbenchIdSchema.safeParse(workbenchId).success || !sessionIdSchema.safeParse(sessionId).success)
      return;
    const kind = event.type === "turn.completed" ? "completion" : "approval";
    const key = JSON.stringify([
      workbench.folder,
      workbenchId,
      sessionId,
      kind,
      event.type === "turn.completed" ? event.turnId : event.approvalId,
    ]);
    if (event.type === "approval.decided") {
      this.seen.add(key);
      if (this.activation?.key === key) this.activation = undefined;
      this.approvals.get(key)?.();
      return;
    }
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const target: NotificationTarget = {
      folder: workbench.folder,
      workbenchId,
      sessionId,
      ...(event.type === "approval.requested" && { approvalPending: event.pending }),
    };
    // ApprovalGate may decide synchronously after publishing the request. Native code is also outside
    // the session's publication stack, even for completions.
    queueMicrotask(() => {
      try {
        const window = this.host.window();
        if (!window) return;
        const foreground = window.visible && !window.minimized && window.focused;
        const preferences = this.host.preferences();
        const eligible = target.approvalPending
          ? preferences.approvalRequests && !foreground && target.approvalPending()
          : preferences.turnCompletion === "always" ||
            (preferences.turnCompletion === "background" && !foreground);
        if (eligible && this.host.supported()) this.show(kind, key, target);
      } catch {
        this.reportFailure();
      }
    });
  }

  takeActivation(token: string): NotificationTarget | undefined {
    const activation = this.activation;
    if (activation?.token !== token) return undefined;
    this.activation = undefined;
    return activation.target.approvalPending?.() === false ? undefined : activation.target;
  }

  private show(kind: "completion" | "approval", key: string, target: NotificationTarget): void {
    const token = randomUUID();
    const notice = this.host.create(
      notificationOptions(kind, this.host.language(), token.replaceAll("-", ""), this.host.platform),
    );
    let shown = false;
    let resolved = false;
    let clicked = false;
    const release = () => {
      this.live.delete(notice);
      this.approvals.delete(key);
    };
    const dismiss = () => {
      release();
      try {
        notice.close();
      } catch {
        this.reportFailure();
      }
    };
    if (kind === "approval") {
      this.approvals.set(key, () => {
        resolved = true;
        this.approvals.delete(key);
        // Windows creates the WinRT toast asynchronously. It is safe to close after 'show'.
        if (shown) queueMicrotask(dismiss);
      });
    }
    this.live.add(notice);
    try {
      notice.on("show", () => {
        shown = true;
        if (resolved) queueMicrotask(dismiss);
      });
      notice.on("failed", () => {
        if (!this.live.has(notice)) return;
        release();
        this.reportFailure();
      });
      notice.on("close", () => {
        if (this.host.platform !== "win32") release();
      });
      notice.on("click", () => {
        if (clicked || resolved || !this.live.has(notice)) return;
        clicked = true;
        if (kind === "completion") release();
        try {
          if (!this.host.window() || target.approvalPending?.() === false) return;
          this.activation = { token, key, target };
          this.host.activate(token);
        } catch {
          this.activation = undefined;
          this.reportFailure();
        }
      });
      notice.show();
    } catch (error) {
      release();
      throw error;
    }
  }

  private reportFailure(): void {
    try {
      this.host.failed();
    } catch {
      // Native notifications are optional even if recording the failure also fails.
    }
  }
}
