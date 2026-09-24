import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A label/value row used throughout the panels and dialogs. */
export default function Kv({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-0.5 text-[13px]", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
