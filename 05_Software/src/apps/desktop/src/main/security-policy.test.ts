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
