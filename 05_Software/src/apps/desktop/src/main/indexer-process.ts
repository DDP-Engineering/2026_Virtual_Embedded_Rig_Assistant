import { inspectSource, selectDocuments } from "@vera/core";
import { createDocumentServices } from "./document-processor.js";
import { createIndexerHandler } from "./indexer-handler.js";

/**
 * The VERA Indexer utility process (TASK-f09609fd): document selection, hashing, extraction,
 * chunking and embeddings run here, so their CPU work and native crashes stay out of main.
 */
const argument = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const models = argument("models");
const port = process.parentPort;
if (!models || !port) throw Error("The indexer needs its model directory and a parent port.");
const services = createDocumentServices(models);
const handle = createIndexerHandler(
  {
    process: services.processDocument,
    select: selectDocuments,
    inspect: inspectSource,
    embeddings: services.embeddings,
  },
  (message) => port.postMessage(message),
);
port.on("message", (event) => handle(event.data));
