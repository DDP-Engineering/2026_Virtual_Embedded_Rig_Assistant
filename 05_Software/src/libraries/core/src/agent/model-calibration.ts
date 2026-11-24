import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { FileAccess } from "../ports.js";
import { MIN_CALIBRATION_RATIO } from "./compaction.js";

const ratioSchema = z.number().min(MIN_CALIBRATION_RATIO).max(1);
const recordSchema = z.strictObject({ format: z.literal(1), ratio: ratioSchema });

export interface ModelCalibration {
  isCurrent(): boolean;
  read(): Promise<number | undefined>;
  save(ratio: number): Promise<void>;
}

/** Optional persistent context estimates shared by sessions of one application data folder. */
export class ModelCalibrationStore {
  constructor(
    private readonly userData: string,
    private readonly files: FileAccess,
    private readonly customConnections: () => readonly {
      slug: string;
      baseUrl: string;
      protocol?: string | undefined;
    }[],
  ) {}

  private path(reference: string): string {
    const connection = reference.startsWith("custom:")
      ? this.customConnections().find((value) => reference.startsWith(`custom:${value.slug}/`))
      : undefined;
    const key = createHash("sha256")
      .update(JSON.stringify([reference, connection?.baseUrl, connection?.protocol]))
      .digest("hex");
    return join(this.userData, "model-calibration", `${key}.json`);
  }

  forModel(reference: string): ModelCalibration {
    const path = this.path(reference);
    let unchanged = true;
    const isCurrent = () => {
      unchanged &&= this.path(reference) === path;
      return unchanged;
    };
    return {
      isCurrent,
      read: async () => {
        try {
          if (!isCurrent()) return undefined;
          const raw = await this.files.read(path);
          if (raw === undefined || !isCurrent()) return undefined;
          const parsed = recordSchema.safeParse(JSON.parse(raw));
          return parsed.success ? parsed.data.ratio : undefined;
        } catch {
          return undefined;
        }
      },
      save: async (ratio) => {
        if (!isCurrent() || !ratioSchema.safeParse(ratio).success) return;
        try {
          await this.files.writeAtomic(path, JSON.stringify({ format: 1, ratio }));
        } catch {
          // Failure to update an estimate must not fail the already completed request.
        }
      },
    };
  }
}
