// Holds a bench-resource lease in its own process until killed: the "other VERA process" (desktop app or CLI) of
// scpi-instruments.test.ts. Arguments: lease folder, identity key, alias, actuates (true|false).
// The lease module alone: the core index also loads model assets this plain Node process does not need.
import { ResourceLeases } from "../../../src/libraries/core/dist/plugins/leases.js";

const [root, key, alias, actuates] = process.argv.slice(2);
const leases = new ResourceLeases({ root, app: "cli" });
await leases.acquire(
  [{ kind: "visa", alias, resource: "test", keys: [key], actuates: actuates === "true" }],
  { sessionId: "other-process", runId: "OTHERPROCESSRUN" },
);
process.stdout.write("held\n");
setInterval(() => {}, 1000);
