import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type BrowserWindow, net, type Session, type WebContents } from "electron";
import { productionCsp } from "./content-policy.js";
import { authorizedSender, type RendererTarget } from "./ipc-router.js";

const mime: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  bcmap: "application/octet-stream",
  pfb: "application/octet-stream",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  woff2: "font/woff2",
};

function contained(root: string, file: string): boolean {
  const path = relative(root, file);
  return (
    path !== "" && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\") && !isAbsolute(path)
  );
}

export async function bundledResponse(root: string, request: Request): Promise<Response> {
  const headers = { "Content-Security-Policy": productionCsp, "X-Content-Type-Options": "nosniff" };
  try {
    const url = new URL(request.url);
    if (url.protocol !== "vera:" || url.host !== "app" || url.username || url.password) {
      return new Response(null, { status: 403, headers });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers });
    }
    const path = decodeURIComponent(url.pathname);
    if (path.includes("\\") || path.includes("\0")) return new Response(null, { status: 403, headers });
    const actualRoot = await realpath(root);
    const file = resolve(actualRoot, `.${path === "/" ? "/index.html" : path}`);
    if (!contained(actualRoot, file)) return new Response(null, { status: 403, headers });
    const actualFile = await realpath(file);
    if (!contained(actualRoot, actualFile)) return new Response(null, { status: 403, headers });
    const extension = actualFile.split(".").at(-1) ?? "";
    const type = mime[extension];
    if (!type) return new Response(null, { status: 404, headers });
    const response = await net.fetch(pathToFileURL(actualFile).href);
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers: { ...headers, "Content-Type": type },
    });
  } catch {
    return new Response(null, { status: 404, headers });
  }
}

interface MicrophonePolicy {
  target(): RendererTarget | undefined;
  permit(request: boolean): boolean;
}

export function secureSession(session: Session, microphone?: MicrophonePolicy): void {
  // Chromium can initialize dictionaries even when spelling is disabled. Route
  // that downloader to local application resources before it schedules work.
  session.setSpellCheckerDictionaryDownloadURL("vera://app/dictionaries/");
  session.setSpellCheckerEnabled(false);
  function permits(
    contents: WebContents | null,
    details: { isMainFrame: boolean; requestingUrl?: string },
    request: boolean,
  ): boolean {
    if (!microphone || !contents || !details.isMainFrame) return false;
    try {
      const target = microphone.target();
      return (
        !!target &&
        details.requestingUrl === target.url &&
        authorizedSender({ sender: contents, senderFrame: contents.mainFrame }, target) &&
        microphone.permit(request)
      );
    } catch {
      return false;
    }
  }
  session.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      permission === "media" &&
        "mediaTypes" in details &&
        details.mediaTypes?.length === 1 &&
        details.mediaTypes[0] === "audio" &&
        permits(contents, details, true),
    ),
  );
  session.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      permission === "media" && details.mediaType === "audio" && permits(contents, details, false),
  );
}

/** Protect sessions at creation, before asynchronous startup or window access. */
export function installSessionPolicy(app: {
  on(event: "session-created", listener: (session: Session) => void): unknown;
}): void {
  app.on("session-created", (session) => secureSession(session));
}

export function secureWindow(window: BrowserWindow): void {
  window.webContents.on("preload-error", (_event, _path, error) => {
    console.error("VERA preload failed", error);
    window.destroy();
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
}
