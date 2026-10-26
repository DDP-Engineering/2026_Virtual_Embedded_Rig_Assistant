import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

/** Removes only this run's temporary output, after Playwright writes its final metadata. */
export default class CleanupE2eOutput {
  constructor({ outputDir }) {
    this.outputDir = resolve(outputDir);
    if (
      dirname(this.outputDir) !== resolve(tmpdir()) ||
      !basename(this.outputDir).startsWith("vera-e2e-output-")
    ) {
      throw new Error("Refusing to clean an unowned Playwright output directory");
    }
  }

  printsToStdio() {
    return false;
  }

  async onExit() {
    await rm(this.outputDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
