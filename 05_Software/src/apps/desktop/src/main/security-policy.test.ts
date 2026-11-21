// REQ-SEC-d0da9a4e
import type { Session } from "electron";
import { expect, it, vi } from "vitest";

vi.mock("electron", () => ({ net: {} }));

import { installSessionPolicy, secureSession } from "./security.js";

it("protects a newly created session synchronously before startup resumes", () => {
  let created: ((session: Session) => void) | undefined;
  const app = {
    on: vi.fn((_event: string, callback: (session: Session) => void) => {
      created = callback;
    }),
  };
  installSessionPolicy(app);
  expect(app.on).toHaveBeenCalledWith("session-created", expect.any(Function));
  const session = {
    setSpellCheckerDictionaryDownloadURL: vi.fn(),
    setSpellCheckerEnabled: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  };
  created?.(session as unknown as Session);
  expect(session.setSpellCheckerEnabled).toHaveBeenCalledWith(false);
  expect(session.setSpellCheckerDictionaryDownloadURL).toHaveBeenCalledWith("vera://app/dictionaries/");
});

it("disables the session dictionary downloader before configuring renderer access", () => {
  const order: string[] = [];
  const session = {
    setSpellCheckerDictionaryDownloadURL: vi.fn((url: string) => order.push(`dictionary:${url}`)),
    setSpellCheckerEnabled: vi.fn((enabled: boolean) => order.push(`spellcheck:${enabled}`)),
    setPermissionRequestHandler: vi.fn(() => order.push("request")),
    setPermissionCheckHandler: vi.fn(() => order.push("check")),
  };
  secureSession(session as unknown as Session);
  expect(session.setSpellCheckerEnabled).toHaveBeenCalledWith(false);
  expect(order.slice(0, 2)).toEqual(["dictionary:vera://app/dictionaries/", "spellcheck:false"]);
  expect(session.setPermissionRequestHandler).toHaveBeenCalledOnce();
  expect(session.setPermissionCheckHandler).toHaveBeenCalledOnce();
});

it("gates both media handlers on audio, the active grant and the exact trusted main frame", () => {
  type Check = NonNullable<Parameters<Session["setPermissionCheckHandler"]>[0]>;
  type Request = NonNullable<Parameters<Session["setPermissionRequestHandler"]>[0]>;
  let check!: Check;
  let request!: Request;
  const session = {
    setSpellCheckerDictionaryDownloadURL: vi.fn(),
    setSpellCheckerEnabled: vi.fn(),
    setPermissionRequestHandler: (handler: Request) => {
      request = handler;
    },
    setPermissionCheckHandler: (handler: Check) => {
      check = handler;
    },
  };
  const url = "vera://app/index.html";
  const contents = {
    mainFrame: { url },
    isDestroyed: () => false,
  } as Parameters<Request>[0];
  const other = { ...contents } as Parameters<Request>[0];
  const permit = vi.fn(() => true);
  secureSession(session as unknown as Session, { target: () => ({ url, webContents: contents }), permit });
  const main = { isMainFrame: true, requestingUrl: url };
  const callback = vi.fn();
  const media = { ...main, mediaTypes: ["audio" as const] };
  request(contents, "media", callback, media);
  expect(callback).toHaveBeenLastCalledWith(true);
  expect(permit).toHaveBeenLastCalledWith(true);
  const origin = "vera://app";
  expect(check(contents, "media", origin, { ...main, mediaType: "audio" })).toBe(true);
  expect(permit).toHaveBeenLastCalledWith(false);
  request(contents, "media", callback, { ...media, mediaTypes: ["audio", "video"] });
  expect(callback).toHaveBeenLastCalledWith(false);
  request(other, "media", callback, media);
  expect(callback).toHaveBeenLastCalledWith(false);
  request(contents, "media", callback, { ...media, isMainFrame: false });
  expect(callback).toHaveBeenLastCalledWith(false);
  expect(check(contents, "media", origin, { ...main, mediaType: "video" })).toBe(false);
  expect(check(contents, "media", origin, { ...main, mediaType: "audio", isMainFrame: false })).toBe(false);
  expect(
    check(contents, "media", origin, { ...main, requestingUrl: "vera://app/other", mediaType: "audio" }),
  ).toBe(false);
  expect(check(contents, "notifications", origin, main)).toBe(false);
  permit.mockReturnValue(false);
  request(contents, "media", callback, media);
  expect(callback).toHaveBeenLastCalledWith(false);
  expect(check(contents, "media", origin, { ...main, mediaType: "audio" })).toBe(false);
});
