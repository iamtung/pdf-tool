import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * App dialog built on shadcn Dialog (Radix): focus trap, Escape and focus return come from Radix.
 * `onClose` omitted = the dialog cannot be dismissed (e.g. a busy export).
 */
export default function Modal({ title, children, actions, wide, onClose }: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  onClose?: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn("max-h-[88vh] overflow-hidden", wide ? "sm:max-w-[980px]" : "sm:max-w-[560px]")}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">{children}</div>
        {actions && <DialogFooter>{actions}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
