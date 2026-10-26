// REQ-UX-4bea0002
import { type ReactNode, useId, useState } from "react";
export function Disclosure({
  title,
  children,
  tool,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  tool?: string | undefined;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section data-tool-row={tool} className={className}>
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {title}
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
