import type { ReactNode } from "react";

export default function Modal({ title, children, actions, wide, onClose }: {
  title: string; children: ReactNode; actions: ReactNode; wide?: boolean; onClose?: () => void;
}) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}
