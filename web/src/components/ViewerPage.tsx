import { useAnalysis, usePageImage } from "../api/hooks";
import type { PlanPage } from "../api/types";
import { formatBytes } from "../lib/format";
import { baseSize } from "../lib/pages";
import { useApp } from "../state/app";
import { usePageDetail } from "../state/selectors";
import RotatedImage from "./RotatedImage";

/** One page of the continuous viewer: its image is fetched only while the item is rendered. */
export default function ViewerPage({ page, n, width, height, scale, zoom }: {
  page: PlanPage; n: number; width: number; height: number; scale: number; zoom: number;
}) {
  const { docs } = useApp();
  const detail = usePageDetail(page);
  const { report } = useAnalysis(page?.source.type === "pdf" ? page.source.docId : null);
  const base = baseSize(page, docs);
  const src = usePageImage(page.source, Math.round(base.width * scale), scale);
  const showBoxes = page.source.type === "pdf" && docs[page.source.docId]?.pages[page.source.index]?.rotation === 0;
  return (
    <div className="relative mx-auto bg-white shadow-md" style={{ width, height }} data-testid={`viewer-page-${n}`}>
      <RotatedImage src={src} width={width} height={height} rotate={page.rotate} alt={`Trang ${n}`}>
        {showBoxes && detail?.placements.map((pl, k) => {
          const img = report?.images[String(pl.xref)];
          const [x0, y0, x1, y1] = pl.bbox;
          return (
            <div key={k} className="group absolute border-2 border-transparent hover:border-amber-400 hover:bg-amber-400/15"
              style={{ left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom }}>
              {img && (
                <span className="absolute top-1 left-1 hidden rounded bg-amber-100 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-amber-700 group-hover:block dark:bg-amber-950 dark:text-amber-300">
                  Ảnh {img.width}×{img.height} · {formatBytes(img.size)} · {img.dpi} DPI
                </span>
              )}
            </div>
          );
        })}
      </RotatedImage>
    </div>
  );
}
