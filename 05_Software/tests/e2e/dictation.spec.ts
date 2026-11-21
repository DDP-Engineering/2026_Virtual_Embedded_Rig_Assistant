import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import type {
  createDictationCapture,
  DictationCaptureResult,
  DictationPhase,
} from "../../src/apps/desktop/src/renderer/dictation/capture.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const models = process.env.VERA_DICTATION_MODEL_ROOT;
const packaged = process.env.VERA_DICTATION_PACKAGED_APP;
const desktop = resolve("src/apps/desktop");
const electron = resolve(
  "node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const clip = resolve("tests/fixtures/dictation/en.wav");

declare global {
  interface Window {
    veraTestDictation: (
      onPhase: (phase: DictationPhase) => void,
    ) => ReturnType<typeof createDictationCapture>;
    dictationTestRun: ReturnType<typeof createDictationCapture>;
    dictationTestDone: Promise<DictationCaptureResult>;
    dictationResumeMic: () => void;
    dictationPcm?: { channels: number; sampleRate: number; samples: number; packed: boolean };
    dictationTestTracks: MediaStreamTrack[];
  }
}

test("built desktop gates and releases a fixture microphone and transcribes offline", async () => {
  test.skip(!models, "Set VERA_DICTATION_MODEL_ROOT to verified local Whisper models");
  test.setTimeout(60_000);
  const userData = await mkdtemp(join(tmpdir(), "vera-dictation-e2e-"));
  let app: ElectronApplication | undefined;
  try {
    await cp(join(models ?? "", "whisper-base"), join(userData, "dictation-models/whisper-base"), {
      recursive: true,
    });
    // Give Chromium a stereo source at 32 kHz. The product audio graph downmixes and resamples to 16 kHz.
    const wav = await readFile(clip);
    const stereo = Buffer.alloc(44 + (wav.length - 44) * 4);
    wav.copy(stereo, 0, 0, 44);
    stereo.writeUInt32LE(stereo.length - 8, 4);
    stereo.writeUInt16LE(2, 22);
    stereo.writeUInt32LE(32_000, 24);
    stereo.writeUInt32LE(128_000, 28);
    stereo.writeUInt16LE(4, 32);
    stereo.writeUInt32LE(stereo.length - 44, 40);
    for (let source = 44, target = 44; source < wav.length; source += 2, target += 8) {
      const sample = wav.readInt16LE(source);
      for (let offset = 0; offset < 8; offset += 2) stereo.writeInt16LE(sample, target + offset);
    }
    const captureClip = join(userData, "fixture.wav");
    await writeFile(captureClip, stereo);
    app = await _electron.launch({
      executablePath: packaged ?? electron,
      chromiumSandbox: true,
      args: [
        ...(packaged ? [] : [desktop]),
        `--user-data-dir=${userData}`,
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${captureClip}%noloop`,
      ],
      env: { ...process.env, VERA_TEST: "1" },
    });
    expect(await app.evaluate(({ app }) => app.getPath("userData"))).toBe(userData);
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.veraTestDictation === "function");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());

    const unactivated = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(
        "window.vera.invoke('dictation.begin', { id: crypto.randomUUID() }).catch(error => error.code)",
        false,
      ),
    );
    expect(unactivated).toBe("DENIED");

    await page.evaluate(async () => {
      const api = (window as unknown as { vera?: VeraBridge }).vera;
      if (!api) throw new Error("Missing VERA bridge");
      await api.invoke("dictation.change", { action: "select", id: "whisper-base" });
      await api.invoke("dictation.change", { action: "language", language: "en" });
    });

    const ambientAudio = () =>
      page.evaluate(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          for (const track of stream.getTracks()) track.stop();
          return "allowed";
        } catch (error) {
          return (error as DOMException).name;
        }
      });
    expect(await ambientAudio()).toBe("NotAllowedError");

    await page.evaluate(() => {
      const NativeWorklet = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends NativeWorklet {
        constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
          super(context, name, options);
          if (name === "vera-dictation-pcm") {
            this.port.addEventListener("message", ({ data }: MessageEvent<unknown>) => {
              if (!(data instanceof Float32Array)) return;
              window.dictationPcm = {
                channels: this.channelCount,
                sampleRate: context.sampleRate,
                samples: data.length,
                packed: data.byteOffset === 0 && data.buffer.byteLength === data.byteLength,
              };
            });
          }
        }
      };
      const media = navigator.mediaDevices;
      const original = media.getUserMedia.bind(media);
      window.dictationTestTracks = [];
      let probeOpening = true;
      media.getUserMedia = async (constraints) => {
        if (constraints?.audio && !constraints.video) {
          for (const denied of [{ video: true }, { audio: true, video: true }]) {
            try {
              const stream = await original(denied);
              for (const track of stream.getTracks()) track.stop();
              document.body.dataset.dictationCamera = "allowed";
            } catch (error) {
              document.body.dataset.dictationCamera ??= (error as DOMException).name;
            }
          }
          if (probeOpening) {
            probeOpening = false;
            await new Promise<void>((resume) => {
              window.dictationResumeMic = resume;
              document.body.dataset.dictationGrant = "open";
            });
          }
        }
        const stream = await original(constraints);
        window.dictationTestTracks.push(...stream.getTracks());
        return stream;
      };
      const onPhase = (phase: DictationPhase) => {
        document.body.dataset.dictationPhase = phase;
      };
      window.dictationTestRun = window.veraTestDictation(onPhase);
      window.dictationTestRun.capture.setSession("first");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Begin dictation fixture";
      button.style.cssText = "position:fixed;right:2rem;bottom:2rem;z-index:99999";
      button.onclick = () => {
        window.dictationTestDone = window.dictationTestRun.capture.start();
      };
      document.body.append(button);
    });

    const start = page.getByRole("button", { name: "Begin dictation fixture" });
    const body = page.locator("body");
    await start.click();
    await expect(body).toHaveAttribute("data-dictation-grant", "open");
    await expect(body).toHaveAttribute("data-dictation-camera", "NotAllowedError");
    const unrelated = await app.evaluate(async ({ BrowserWindow }) => {
      const candidate = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      try {
        await candidate.loadURL("vera://app/index.html");
        return await candidate.webContents.executeJavaScript(
          "navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return 'allowed'},e=>e.name)",
        );
      } finally {
        candidate.destroy();
      }
    });
    expect(unrelated).toBe("NotAllowedError");
    await page.evaluate(() => window.dictationResumeMic());
    await expect(body).toHaveAttribute("data-dictation-phase", "recording");

    // The controlled fixture has 5.28 seconds of speech.
    await page.waitForTimeout(5_800);
    expect(
      await page.evaluate(() => {
        window.dictationTestRun.capture.stop();
        return window.dictationTestTracks.map((track) => track.readyState);
      }),
    ).toEqual(["ended"]);
    const recognized = await page.evaluate(() => window.dictationTestDone);
    expect(recognized).toMatchObject({ status: "complete", language: "en", session: "first" });
    const pcm = await page.evaluate(() => window.dictationPcm);
    expect(pcm).toMatchObject({ channels: 1, sampleRate: 16_000, packed: true });
    expect(pcm?.samples).toBeGreaterThanOrEqual(16_000 * 5);
    expect(pcm?.samples).toBeLessThanOrEqual(16_000 * 30);
    if (recognized.status === "complete") expect(recognized.text.toLowerCase()).toContain("open the window");
    expect(await ambientAudio()).toBe("NotAllowedError");

    await start.click();
    await expect(body).toHaveAttribute("data-dictation-phase", "recording");
    expect(
      await page.evaluate(() => {
        window.dictationTestRun.capture.setSession("second");
        return window.dictationTestTracks.map((track) => track.readyState);
      }),
    ).toEqual(["ended", "ended"]);
    await expect(page.evaluate(() => window.dictationTestDone)).resolves.toEqual({ status: "cancelled" });

    await start.click();
    await expect(body).toHaveAttribute("data-dictation-phase", "recording");
    const other = await app.evaluate(async ({ BrowserWindow }) => {
      const focusTarget = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await focusTarget.loadURL("about:blank");
      focusTarget.show();
      focusTarget.focus();
      return focusTarget.id;
    });
    await expect
      .poll(() => app?.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id))
      .toBe(other);
    await expect(body).toHaveAttribute("data-dictation-phase", "idle");
    await expect(page.evaluate(() => window.dictationTestDone)).resolves.toEqual({ status: "cancelled" });
    expect(
      await page.evaluate(() => window.dictationTestTracks.every((track) => track.readyState === "ended")),
    ).toBe(true);
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), other);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 3 });
  }
});
