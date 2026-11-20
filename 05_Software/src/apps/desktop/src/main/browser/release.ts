/** Playwright 1.64.0 browsers.json pairs revision 1248 with Chrome for Testing 156.0.8078.4. */
const chromiumVersion = "156.0.8078.4";
const releaseRoot = `https://storage.googleapis.com/chrome-for-testing-public/${chromiumVersion}`;

export interface BrowserRelease {
  version: string;
  url: string;
  executable: string;
  archiveBytes: number;
  archiveSha256: string;
  treeSha256: string;
  executables: string[];
}

/** ZIP hashes are for the official immutable Chrome for Testing artifacts selected by the Playwright pin. */
export function browserRelease(platform = process.platform, arch = process.arch): BrowserRelease | undefined {
  if (arch !== "x64") return undefined;
  if (platform === "win32") {
    return {
      version: chromiumVersion,
      url: `${releaseRoot}/win64/chrome-win64.zip`,
      executable: "chrome-win64/chrome.exe",
      archiveBytes: 207073013,
      archiveSha256: "220021ecfdad08c116fc71a153e65e3861ba841c531afc4f7acc7bd5d44b41db",
      treeSha256: "6af89f3d454a6fd2cc55fd8905ae7688a12716e5d6040319e2e8236f3f02fed0",
      executables: [],
    };
  }
  if (platform === "linux") {
    return {
      version: chromiumVersion,
      url: `${releaseRoot}/linux64/chrome-linux64.zip`,
      executable: "chrome-linux64/chrome",
      archiveBytes: 200345244,
      archiveSha256: "43fd31766c7533a02dda2ded5ad50c2f861cd5400be7509c0abad71129f79d79",
      treeSha256: "3241ad089665022fd5eeb9a5343db88c2c6139f955c4b73b01367348c22edc16",
      executables: ["chrome-linux64/chrome", "chrome-linux64/chrome_crashpad_handler"],
    };
  }
  return undefined;
}
