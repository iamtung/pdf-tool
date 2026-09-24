import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePageImage } from "../api/hooks";
import type { PlanPage } from "../api/types";
import { LEVEL_LABEL, formatBytes } from "../lib/format";
import { displaySize } from "../lib/pages";
import { cn } from "@/lib/utils";
import { useApp } from "../state/app";
import { useCurrentPage, usePageDetail } from "../state/selectors";
import RotatedImage from "./RotatedImage";

const THUMB_W = 122;
const GAP = 14;
const LABEL = 18;
const DRAG_TYPE = "application/x-pdftool-pages";

type Mods = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };

function Thumb({ page, n, selected, current, onSelect, onDragStart }: {
  page: PlanPage; n: number; selected: boolean; current: boolean;
  onSelect: (m: Mods) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const { docs, estimates } = useApp();
  const detail = usePageDetail(page);
  const { width, height } = displaySize(page, docs);
  const h = Math.round((THUMB_W * height) / width);
  const src = usePageImage(page.source, Math.min(320, Math.round(160 * window.devicePixelRatio)));
  const est = estimates[page.id];
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onSelect(e);
  };
  return (
    <>
      <div
        className={cn(
          "relative flex cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-white",
          detail?.heavy && "border-2 border-amber-400",
          current && "ring-1 ring-primary",
          selected && "outline-3 outline-offset-1 outline-primary",
        )}
        style={{ height: h }}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        draggable
        onDragStart={onDragStart}
        data-testid={`thumb-${n}`}
        role="option"
        aria-selected={selected}
        aria-label={`Trang ${n}`}
        tabIndex={0}
      >
        <RotatedImage src={src} width={THUMB_W - 2} height={h - 2} rotate={page.rotate} alt={`Trang ${n}`} />
        {detail?.heavy && (
          <span className="absolute top-1 left-1 rounded bg-amber-100 px-1.5 py-px text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            {formatBytes(detail.size)}
          </span>
        )}
        {page.compress && (
          <span className="absolute right-1 bottom-1 rounded bg-accent px-1.5 py-px text-[10px] text-accent-foreground">
            {LEVEL_LABEL[page.compress]}{est ? ` · ~${formatBytes(est)}` : ""}
          </span>
        )}
      </div>
      <div className="py-1 text-center text-[11px] text-muted-foreground">{n}</div>
    </>
  );
}

export default function ThumbnailStrip() {
  const { editor, dispatch, docs, selected, setSelected, setCurrentId, setDialog } = useApp();
  const { page: current, index: currentIndex } = useCurrentPage();
  const pages = editor.plan.pages;
  const parent = useRef<HTMLDivElement>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  /** Shift-click range anchor: last page clicked without Shift. */
  const anchorId = useRef<string | null>(null);

  const virtualizer = useVirtualizer({
    count: pages.length + 1, // +1: trailing insert gap
    getScrollElement: () => parent.current,
    getItemKey: (i) => pages[i]?.id ?? "__end",
    estimateSize: (i) => {
      if (i === pages.length) return GAP * 2;
      const { width, height } = displaySize(pages[i], docs);
      return GAP + Math.round((THUMB_W * height) / width) + LABEL;
    },
    overscan: 6,
  });
  // Rotation / reorder / newly opened docs change item sizes.
  useEffect(() => virtualizer.measure(), [pages, docs, virtualizer]);

  const select = (m: Mods, i: number) => {
    const id = pages[i].id;
    const anchor = anchorId.current;
    const anchorIndex = anchor && selected.has(anchor) ? pages.findIndex((p) => p.id === anchor) : -1;
    const from = anchorIndex >= 0 ? anchorIndex : currentIndex;
    const additive = m.metaKey || m.ctrlKey;
    if (m.shiftKey && from >= 0) {
      const [a, b] = [Math.min(from, i), Math.max(from, i)];
      const range = pages.slice(a, b + 1).map((p) => p.id);
      setSelected(new Set(additive ? [...selected, ...range] : range));
    } else if (additive) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
      anchorId.current = id;
    } else {
      setSelected(new Set([id]));
      anchorId.current = id;
    }
    setCurrentId(id);
  };

  const dragStart = (e: React.DragEvent, i: number) => {
    const id = pages[i].id;
    const ids = selected.has(id) ? pages.filter((p) => selected.has(p.id)).map((p) => p.id) : [id];
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  };
  /** Drop index for a pointer over slot i: top half = before page i, bottom half = after it. */
  const indexAt = (e: React.DragEvent, i: number) => {
    if (i >= pages.length) return pages.length;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? i : i + 1;
  };
  const dragOver = (e: React.DragEvent, i: number) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(indexAt(e, i));
  };
  const drop = (e: React.DragEvent, i: number) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    setDropIndex(null);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: "move", ids: JSON.parse(raw), toIndex: indexAt(e, i) });
  };
  const dragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null);
  };

  return (
    <div className="relative min-h-0 overflow-y-auto border-r bg-muted/30" ref={parent} role="listbox"
      aria-multiselectable aria-label="Các trang"
      onDragLeave={dragLeave} onDragEnd={() => setDropIndex(null)}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div key={item.key} className="absolute right-0 left-0 px-3.5"
            style={{ top: item.start, height: item.size }}
            onDragOver={(e) => dragOver(e, item.index)} onDrop={(e) => drop(e, item.index)}>
            <div className="group/gap relative flex h-3.5 items-center justify-center"
              data-testid={`insert-gap-${item.index}`}>
              {dropIndex === item.index && (
                <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-primary" />
              )}
              <button
                type="button"
                aria-label="+ Chèn"
                className="hidden rounded border bg-background px-2 text-[11px] leading-3.5 group-hover/gap:block"
                onClick={() => setDialog({ kind: "insert", at: item.index })}
              >
                <Plus className="inline size-3" /> Chèn
              </button>
            </div>
            {item.index < pages.length && (
              <Thumb
                page={pages[item.index]} n={item.index + 1}
                selected={selected.has(pages[item.index].id)} current={current?.id === pages[item.index].id}
                onSelect={(m) => select(m, item.index)}
                onDragStart={(e) => dragStart(e, item.index)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
