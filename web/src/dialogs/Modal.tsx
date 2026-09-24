import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
}

function focusFirst(root: HTMLElement) {
  const auto = root.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
  (auto ?? focusables(root)[0] ?? root).focus();
}

/** Open modals, bottom to top: only the top one reacts to keys (password prompt over a dialog). */
const stack: HTMLElement[] = [];

/** True while any Modal is open (for app-level keyboard shortcuts). */
export function isModalOpen(): boolean {
  return stack.length > 0;
}

/**
 * Modal dialog. While it is the top modal: Escape calls onClose and does not reach app shortcuts,
 * Tab is trapped inside, the first focusable element (or an [autofocus] one) is focused on open,
 * and focus returns to the previously focused element on close.
 */
export default function Modal({ title, children, actions, wide, onClose }: {
  title: string; children: ReactNode; actions: ReactNode; wide?: boolean; onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    stack.push(root);
    if (!root.contains(document.activeElement)) focusFirst(root);

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(root);
      const active = document.activeElement;
      if (!items.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = root.contains(active);
      if (e.shiftKey && (!inside || active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const i = stack.lastIndexOf(root);
      if (i >= 0) stack.splice(i, 1);
      if (previous && previous.isConnected && previous !== document.body) previous.focus();
    };
  }, []);

  // Content can change under the focused element (e.g. progress -> result): keep focus inside.
  useEffect(() => {
    const root = ref.current;
    if (root && stack[stack.length - 1] === root && (!document.activeElement || document.activeElement === document.body)) {
      focusFirst(root);
    }
  });

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <h2>{title}</h2>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}
