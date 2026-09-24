import { useEffect, useState } from "react";
import { useAnalysis, usePageImage } from "../api/hooks";
import { formatBytes } from "../lib/format";
import { baseSize, displaySize } from "../lib/pages";
import { useApp } from "../state/app";
import { useCurrentPage, usePageDetail, useTargetIds } from "../state/selectors";
import RotatedImage from "./RotatedImage";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Width of an element, tracked via a callback ref so it follows mounts/remounts. */
function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

export default function PageViewer() {
  const { editor, dispatch, docs, setSelected, setCurrentId, setDialog } = useApp();
  const { page, index } = useCurrentPage();
  const targets = useTargetIds();
  const [canvasRef, width] = useWidth();
  const [zoom, setZoom] = useState<number | null>(null); // null = fit width
  const detail = usePageDetail(page);
  const { report } = useAnalysis(page?.source.type === "pdf" ? page.source.docId : null);
  const pages = editor.plan.pages;

  const size = page ? displaySize(page, docs) : { width: 595, height: 842 };
  const fit = Math.min(1.5, Math.max(0.2, (width - 40) / size.width));
  const z = zoom ?? fit;
  const scale = Math.min(8, Math.ceil(z * window.devicePixelRatio * 4) / 4); // 0.25 steps -> cache hits; API max 8
  const base = page ? baseSize(page, docs) : size;
  const src = usePageImage(page?.source ?? { type: "blank", width: 1, height: 1 }, Math.round(base.width * scale), scale);

  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.01) : [...ZOOMS].reverse().find((v) => v < z - 0.01);
    if (next) setZoom(next);
  };

  if (!page) {
    return (
      <div className="viewer">
        <div className="viewer-canvas muted" ref={canvasRef}>Không còn trang nào.</div>
      </div>
    );
  }

  const showBoxes = page.source.type === "pdf" && docs[page.source.docId]?.pages[page.source.index]?.rotation === 0;
  const extract = () => setDialog({ kind: "export", onlyIds: targets });
  const goTo = (i: number) => {
    const id = pages[i].id;
    setCurrentId(id);
    setSelected(new Set([id]));
  };
  const remove = () => {
    const next = pages.find((p, i) => i > index && !targets.includes(p.id)) ?? pages.find((p) => !targets.includes(p.id));
    dispatch({ type: "delete", ids: targets });
    setSelected(new Set());
    setCurrentId(next?.id ?? null);
  };
  const splitHere = () => {
    const n = pages.length;
    const ranges = index > 0 ? `1-${index}, ${index + 1}-${n}` : `1-${n}`;
    setDialog({ kind: "split", ranges });
  };

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <button title="Xóa trang (Delete)" onClick={remove}>Xóa</button>
        <button title="Xoay trái" aria-label="Xoay trái" onClick={() => dispatch({ type: "rotate", ids: targets, delta: -90 })}>⟲</button>
        <button title="Xoay phải" aria-label="Xoay phải" onClick={() => dispatch({ type: "rotate", ids: targets, delta: 90 })}>⟳</button>
        <button title="Trích các trang đang chọn thành file mới" onClick={extract}>Trích</button>
        <button title="Tách file" onClick={splitHere}>Tách</button>
        <span className="small muted">{targets.length > 1 ? `${targets.length} trang đang chọn` : ""}</span>
        <div className="spacer" />
        <button className="icon" aria-label="Trang trước" title="Trang trước" disabled={index <= 0} onClick={() => goTo(index - 1)}>‹</button>
        <span className="small">Trang {index + 1} / {pages.length}</span>
        <button className="icon" aria-label="Trang sau" title="Trang sau" disabled={index >= pages.length - 1} onClick={() => goTo(index + 1)}>›</button>
        <button className="icon" aria-label="Thu nhỏ" title="Thu nhỏ" onClick={() => step(-1)}>−</button>
        <button className="small" onClick={() => setZoom(null)} title="Vừa khung">{Math.round(z * 100)}%</button>
        <button className="icon" aria-label="Phóng to" title="Phóng to" onClick={() => step(1)}>+</button>
      </div>
      <div className="viewer-canvas" ref={canvasRef}>
        <div className="page-frame">
          <RotatedImage src={src} width={size.width * z} height={size.height * z} rotate={page.rotate} alt={`Trang ${index + 1}`}>
            {showBoxes && detail?.placements.map((pl, k) => {
              const img = report?.images[String(pl.xref)];
              const [x0, y0, x1, y1] = pl.bbox;
              const sx = z; // overlay lives in the unrotated inner box (base size * zoom)
              return (
                <div key={k} className="img-box"
                  style={{ left: x0 * sx, top: y0 * sx, width: (x1 - x0) * sx, height: (y1 - y0) * sx }}>
                  {img && <span className="img-tip">Ảnh {img.width}×{img.height} · {formatBytes(img.size)} · {img.dpi} DPI</span>}
                </div>
              );
            })}
          </RotatedImage>
        </div>
      </div>
    </div>
  );
}
