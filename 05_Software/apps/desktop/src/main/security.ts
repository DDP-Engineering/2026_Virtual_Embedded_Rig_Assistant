import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type BrowserWindow, net, type Session } from "electron";
import { productionCsp } from "./content-policy.js";

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

export function secureSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
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
