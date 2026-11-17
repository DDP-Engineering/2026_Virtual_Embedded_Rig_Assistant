import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

export const ViewerToolbarTarget = createContext<HTMLElement | null>(null);

/** Places viewer controls beside the file mode buttons in a document tab. */
export function ViewerToolbar({ children }: { children: ReactNode }) {
  const target = useContext(ViewerToolbarTarget);
  return target ? createPortal(children, target) : children;
}
