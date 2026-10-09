import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { EvidenceDrawer } from "./EvidenceDrawer";

interface EvidenceOpener {
  open(ref: string): void;
}

const EvidenceContext = createContext<EvidenceOpener>({ open: () => {} });

export const useEvidenceOpener = () => useContext(EvidenceContext);

/** App default: evidence opens in a side drawer (05 §6). The session workspace overrides it with its Evidence tab. */
export function EvidenceDrawerProvider({ children }: { children: ReactNode }) {
  const [ref, setRef] = useState<string | null>(null);
  const value = useMemo(() => ({ open: setRef }), []);
  return (
    <EvidenceContext.Provider value={value}>
      {children}
      <EvidenceDrawer evidenceRef={ref} onClose={() => setRef(null)} />
    </EvidenceContext.Provider>
  );
}

export function EvidenceOpenerProvider({ open, children }: { open: (ref: string) => void; children: ReactNode }) {
  const value = useMemo(() => ({ open }), [open]);
  return <EvidenceContext.Provider value={value}>{children}</EvidenceContext.Provider>;
}
