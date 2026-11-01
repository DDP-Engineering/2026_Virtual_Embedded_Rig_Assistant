import { opensExternally } from "@vera/shared";

/** Whether a source path is a workbench document the default application may open. */
export const canOpenExternally = (path: string) => opensExternally(path) && !path.startsWith(".vera/");
