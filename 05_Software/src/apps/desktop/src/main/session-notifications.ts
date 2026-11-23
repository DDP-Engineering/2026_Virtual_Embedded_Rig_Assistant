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

type NotificationKind = Parameters<typeof notificationOptions>[0];

export interface NotificationTarget {
  folder: string;
  workbenchId: string;
  sessionId: string;
  pending?: () => boolean;
  questionId?: string;
}

/** Delivers live session alerts and hands out a target only after a click on the OS notification. */
export class SessionNotifications {
  private readonly seen = new Set<string>();
  private readonly requests = new Map<string, (() => void) | undefined>();
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
    const kind =
      event.type === "turn.completed" ? "completion" : "questionId" in event ? "question" : "approval";
    const id =
      "questionId" in event ? event.questionId : "approvalId" in event ? event.approvalId : event.turnId;
    const key = JSON.stringify([workbench.folder, workbenchId, sessionId, kind, id]);
    if (event.type === "approval.decided" || event.type === "question.settled") {
      this.seen.add(key);
      if (this.activation?.key === key) this.activation = undefined;
      const settle = this.requests.get(key);
      this.requests.delete(key);
      settle?.();
      return;
    }
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const target: NotificationTarget = {
      folder: workbench.folder,
      workbenchId,
      sessionId,
      ...("pending" in event && { pending: event.pending }),
      ...(event.type === "question.requested" && { questionId: event.questionId }),
    };
    if (target.pending) this.requests.set(key, undefined);
    // A request may settle synchronously when published. Keep the native presenter outside that stack.
    queueMicrotask(() => {
      if (target.pending && !this.requests.delete(key)) return;
      try {
        const window = this.host.window();
        if (!window) return;
        const foreground = window.visible && !window.minimized && window.focused;
        const preferences = this.host.preferences();
        const eligible =
          kind === "completion"
            ? preferences.turnCompletion === "always" ||
              (preferences.turnCompletion === "background" && !foreground)
            : !foreground &&
              (kind === "question" ? preferences.questionRequests : preferences.approvalRequests) &&
              target.pending?.();
        if (eligible && this.host.supported()) this.show(kind, key, target);
      } catch {
        this.reportFailure();
      }
    });
  }

  takeActivation(token: string): NotificationTarget | undefined {
    const activation = this.activation;
    if (!activation || activation.token !== token) return undefined;
    this.activation = undefined;
    return activation.target.pending?.() === false ? undefined : activation.target;
  }

  private show(kind: NotificationKind, key: string, target: NotificationTarget): void {
    const token = randomUUID();
    const notice = this.host.create(
      notificationOptions(kind, this.host.language(), token.replaceAll("-", ""), this.host.platform),
    );
    let shown = false;
    let resolved = false;
    let clicked = false;
    const release = () => {
      this.live.delete(notice);
      this.requests.delete(key);
    };
    const dismiss = () => {
      release();
      try {
        notice.close();
      } catch {
        this.reportFailure();
      }
    };
    if (target.pending) {
      this.requests.set(key, () => {
        resolved = true;
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
          if (!this.host.window() || target.pending?.() === false) return;
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
