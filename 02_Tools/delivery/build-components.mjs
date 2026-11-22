import { join } from "node:path";
import { parseArgs } from "node:util";
import { componentsPart, writeComponentsPart } from "./components.mjs";
import { currentDelivery, printPart } from "./delivery-common.mjs";

// Builds 07_Delivery/vera-<version>/components/ on a host with network: the Chrome for Testing ZIP of each
// platform and one ZIP per Whisper model, all checked against the Desktop pins, with THIRD-PARTY-NOTICES.md and
// SHA256SUMS. Any host builds both platforms: the files are downloads, not builds. Desktop installs them offline
// with Install from file... in Settings.
const { values } = parseArgs({ options: { replace: { type: "boolean", default: false } } });
const delivery = await currentDelivery();
const files = await writeComponentsPart(delivery, { replace: values.replace });
printPart(join(delivery.folder, componentsPart), files, "npm run delivery:verify");
