import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EvidenceViewer } from "./EvidenceViewer";

/** Side drawer for evidence opened outside the session workspace (report page, testbench). */
export function EvidenceDrawer({ evidenceRef, onClose }: { evidenceRef: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!evidenceRef} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[640px] gap-0 sm:max-w-[640px]">
        <SheetHeader className="border-b">
          <SheetTitle>Evidence</SheetTitle>
          <SheetDescription>The packet, log line, metric or document behind a claim.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto p-4">{evidenceRef && <EvidenceViewer evidenceRef={evidenceRef} />}</div>
      </SheetContent>
    </Sheet>
  );
}
