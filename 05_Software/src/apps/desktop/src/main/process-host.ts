import { spawn } from "node:child_process";
import { NodeProcessHost } from "@vera/core";
/** Desktop main grants core process execution through the ProcessHost port; core never imports child_process. */
export function createDesktopProcessHost() {
  return new NodeProcessHost(spawn);
}
