import { createContext } from "react";

/** Workbench-scoped terminal reveal requests, shared by chat and the terminal panel. */
export const TerminalNavigation = createContext<
  | {
      workbenchId: string;
      available: boolean;
      target?: { id: string } | undefined;
      reveal(id: string): void;
    }
  | undefined
>(undefined);
