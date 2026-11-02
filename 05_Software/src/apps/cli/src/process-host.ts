import { spawn } from "node:child_process";
import { NodeProcessHost } from "@vera/core";
/** The CLI grants core process execution through the ProcessHost port; core never imports child_process. */
export function createCliProcessHost() {
  return new NodeProcessHost(spawn);
}
