// REQ-UX-b5edf930 REQ-UX-f8ec3a43
import { createContext, useContext } from "react";

/**
 * Workbench entries attached to each session's next message (TASK-2fef1397). App owns them; the
 * Docs tree attaches, the composer shows them as chips and sends them as `@path` mentions.
 */
export interface Attachments {
  list(sessionId: string): readonly string[];
  remove(sessionId: string, path: string): void;
  /** Drops the paths a sent message carried. */
  clear(sessionId: string, paths: readonly string[]): void;
  /**
   * Attaches an entry to the chat VERA shows, opening the active session or creating one; absent
   * where no chat can take it (no workbench, a read-only one).
   */
  attach?: ((path: string) => void) | undefined;
  /** Whether the session an attachment would go to already holds the most entries allowed. */
  full: boolean;
}
export const AttachmentsContext = createContext<Attachments | undefined>(undefined);
export const useAttachments = () => useContext(AttachmentsContext);
