import { useEffect, useRef, useState } from "react";
import { useAnalysis, usePageImage } from "../api/hooks";
import { formatBytes } from "../lib/format";
import { displaySize } from "../lib/pages";
import { useStartExport } from "../state/actions";
import { useApp } from "../state/app";
import { useCurrentPage, usePageDetail, useTargetIds } from "../state/selectors";
import RotatedImage from "./RotatedImage";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setW(entry.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export default function PageViewer() {
  const { editor, dispatch, docs, setSelected, setCurrentId, setDialog } = useApp();
  const { page, index } = useCurrentPage();
  const targets = useTargetIds();
  const startExport = useStartExport();
  const canvas = useRef<HTMLDivElement>(null);
  const width = useWidth(canvas);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit width
  const detail = usePageDetail(page);
  const { report } = useAnalysis(page?.source.type === "pdf" ? page.source.docId : null);
  const pages = editor.plan.pages;

  const size = page ? displaySize(page, docs) : { width: 595, height: 842 };
  const fit = Math.min(1.5, Math.max(0.2, (width - 40) / size.width));
  const z = zoom ?? fit;
  const scale = Math.ceil(z * window.devicePixelRatio * 4) / 4; // 0.25 steps -> cache hits
  const src = usePageImage(page?.source ?? { type: "blank", width: 1, height: 1 }, Math.round(size.width * scale), scale);

  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.01) : [...ZOOMS].reverse().find((v) => v < z - 0.01);
    if (next) setZoom(next);
  };

  if (!page) return <div className="viewer"><div className="viewer-canvas muted">Không còn trang nào.</div></div>;

  const showBoxes = page.source.type === "pdf" && docs[page.source.docId]?.pages[page.source.index]?.rotation === 0;
  const extract = () => startExport({ pages: pages.filter((p) => targets.includes(p.id)), fileCompression: editor.plan.fileCompression });
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
        <button title="Xoay trái" onClick={() => dispatch({ type: "rotate", ids: targets, delta: -90 })}>⟲</button>
        <button title="Xoay phải" onClick={() => dispatch({ type: "rotate", ids: targets, delta: 90 })}>⟳</button>
        <button title="Trích các trang đang chọn thành file mới" onClick={extract}>Trích</button>
        <button title="Tách file" onClick={splitHere}>Tách</button>
        <span className="small muted">{targets.length > 1 ? `${targets.length} trang đang chọn` : ""}</span>
        <div className="spacer" />
        <button className="icon" disabled={index <= 0} onClick={() => setCurrentId(pages[index - 1].id)}>‹</button>
        <span className="small">Trang {index + 1} / {pages.length}</span>
        <button className="icon" disabled={index >= pages.length - 1} onClick={() => setCurrentId(pages[index + 1].id)}>›</button>
        <button className="icon" onClick={() => step(-1)}>−</button>
        <button className="small" onClick={() => setZoom(null)} title="Vừa khung">{Math.round(z * 100)}%</button>
        <button className="icon" onClick={() => step(1)}>+</button>
      </div>
      <div className="viewer-canvas" ref={canvas}>
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
