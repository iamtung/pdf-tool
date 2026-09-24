import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";
import { usePageImage } from "../api/hooks";
import type { PlanPage } from "../api/types";
import { LEVEL_LABEL, formatBytes } from "../lib/format";
import { displaySize } from "../lib/pages";
import { useApp } from "../state/app";
import { useCurrentPage, usePageDetail } from "../state/selectors";
import RotatedImage from "./RotatedImage";

const THUMB_W = 122;
const GAP = 14;
const LABEL = 18;
const DRAG_TYPE = "application/x-pdftool-pages";

function Thumb({ page, n, selected, current, dropBefore, onClick, onDragStart, onDragOver, onDrop }: {
  page: PlanPage; n: number; selected: boolean; current: boolean; dropBefore: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const { docs, estimates } = useApp();
  const detail = usePageDetail(page);
  const { width, height } = displaySize(page, docs);
  const h = Math.round((THUMB_W * height) / width);
  const src = usePageImage(page.source, 160);
  const cls = ["thumb", detail?.heavy && "heavy", selected && "selected", current && "current", dropBefore && "drop-before"]
    .filter(Boolean).join(" ");
  const est = estimates[page.id];
  return (
    <>
      <div className={cls} style={{ height: h }} onClick={onClick} draggable
        onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} data-testid={`thumb-${n}`}>
        <RotatedImage src={src} width={THUMB_W - 2} height={h - 2} rotate={page.rotate} alt={`Trang ${n}`} />
        {detail?.heavy && <span className="tag size">{formatBytes(detail.size)}</span>}
        {page.compress && (
          <span className="tag level">{LEVEL_LABEL[page.compress]}{est ? ` · ~${formatBytes(est)}` : ""}</span>
        )}
      </div>
      <div className="thumb-label">{n}</div>
    </>
  );
}

export default function ThumbnailStrip() {
  const { editor, dispatch, docs, selected, setSelected, setCurrentId, setDialog } = useApp();
  const { page: current, index: currentIndex } = useCurrentPage();
  const pages = editor.plan.pages;
  const parent = useRef<HTMLDivElement>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const virtualizer = useVirtualizer({
    count: pages.length + 1, // +1: trailing insert gap
    getScrollElement: () => parent.current,
    estimateSize: (i) => {
      if (i === pages.length) return GAP * 2;
      const { width, height } = displaySize(pages[i], docs);
      return GAP + Math.round((THUMB_W * height) / width) + LABEL;
    },
    overscan: 6,
  });

  const click = (e: React.MouseEvent, i: number) => {
    const id = pages[i].id;
    if (e.shiftKey && currentIndex >= 0) {
      const [a, b] = [Math.min(currentIndex, i), Math.max(currentIndex, i)];
      setSelected(new Set(pages.slice(a, b + 1).map((p) => p.id)));
    } else if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected);
      next.has(id) ? next.delete(id) : next.add(id);
      setSelected(next);
    } else {
      setSelected(new Set([id]));
    }
    setCurrentId(id);
  };

  const dragStart = (e: React.DragEvent, i: number) => {
    const id = pages[i].id;
    const ids = selected.has(id) ? pages.filter((p) => selected.has(p.id)).map((p) => p.id) : [id];
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  };
  const dragOver = (e: React.DragEvent, i: number) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropIndex(e.clientY < rect.top + rect.height / 2 ? i : i + 1);
  };
  const drop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw || dropIndex === null) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: "move", ids: JSON.parse(raw), toIndex: dropIndex });
    setDropIndex(null);
  };

  return (
    <div className="strip" ref={parent} onDragLeave={() => setDropIndex(null)}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div key={item.key} className="thumb-slot" style={{ top: item.start, height: item.size }}>
            <div className="gap">
              <button onClick={() => setDialog({ kind: "insert", at: item.index })}>+ Chèn</button>
            </div>
            {item.index < pages.length && (
              <Thumb
                page={pages[item.index]} n={item.index + 1}
                selected={selected.has(pages[item.index].id)} current={current?.id === pages[item.index].id}
                dropBefore={dropIndex === item.index}
                onClick={(e) => click(e, item.index)}
                onDragStart={(e) => dragStart(e, item.index)}
                onDragOver={(e) => dragOver(e, item.index)}
                onDrop={drop}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
