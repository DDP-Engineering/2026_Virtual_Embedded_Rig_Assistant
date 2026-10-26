// Adapted from BenchPilot's shadcn/ui card; only the shell primitive is needed here.
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}
