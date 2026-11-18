import type { ProgramRunner } from "@vera/core";
import { type PluginProgramStatus, veraError, type WorkbenchSnapshot } from "@vera/shared";
import { scrubProgramStatuses } from "./program-statuses.js";

/** A log opened in a tab is read, scrubbed and sent over IPC whole; a longer one shows this tail. */
const FULL_LOG_BYTES = 8 * 1024 * 1024;

/** Projects raw host run data at publication, using the current owner's live runs policy. */
export class RunPresentation {
  constructor(
    private readonly host: {
      current(): WorkbenchSnapshot;
      maskingFor(config: Pick<WorkbenchSnapshot["config"], "privacy">, area: "runs"): boolean;
      scrub(text: string): string;
      runner: Pick<ProgramRunner, "list" | "log">;
    },
  ) {}

  private owner(id: string) {
    let current: WorkbenchSnapshot;
    try {
      current = this.host.current();
    } catch {
      throw veraError("CONFLICT");
    }
    if (current.config.id !== id) throw veraError("CONFLICT");
    return current;
  }

  private projector(owner?: WorkbenchSnapshot) {
    if (owner) {
      const current = this.owner(owner.config.id);
      if (current.folder !== owner.folder) throw veraError("CONFLICT");
      return this.host.maskingFor(current.config, "runs") ? this.host.scrub : (text: string) => text;
    }
    return this.host.maskingFor({}, "runs") ? this.host.scrub : (text: string) => text;
  }

  async list(id: string) {
    const owner = this.owner(id);
    const runs = await this.host.runner.list(owner.folder);
    const scrub = this.projector(owner);
    return {
      runs: runs.map((run) => ({
        ...run,
        args: run.args.map(scrub),
        ...(run.command ? { command: { text: scrub(run.command.text), cwd: scrub(run.command.cwd) } } : {}),
        ...(run.error === undefined ? {} : { error: scrub(run.error) }),
      })),
    };
  }

  async log(id: string, runId: string, full?: boolean) {
    const owner = this.owner(id);
    const log = await this.host.runner.log(owner.folder, runId, full ? FULL_LOG_BYTES : undefined);
    return { ...log, text: this.projector(owner)(log.text) };
  }

  async statuses(read: () => Promise<PluginProgramStatus[]>, id?: string) {
    const owner = id === undefined ? undefined : this.owner(id);
    const statuses = await read();
    return scrubProgramStatuses(statuses, this.projector(owner));
  }
}
