import { useEffect, useState } from "react";
import { useAnalysis, useEstimate } from "../api/hooks";
import type { Level } from "../api/types";
import { KIND_LABEL, LEVEL_LABEL, formatBytes, paperName } from "../lib/format";
import { displaySize } from "../lib/pages";
import { useApp } from "../state/app";
import { useCurrentPage, usePageDetail, useTargetIds } from "../state/selectors";
import FileOverview from "./FileOverview";

const LEVELS: Level[] = ["light", "medium", "strong"];

export default function PagePanel() {
  const { selected } = useApp();
  return <aside className="panel">{selected.size ? <PageInfo /> : <FileOverview />}</aside>;
}

function PageInfo() {
  const { editor, dispatch, docs, setEstimates } = useApp();
  const { page, index } = useCurrentPage();
  const targets = useTargetIds();
  const detail = usePageDetail(page);
  const { report } = useAnalysis(page?.source.type === "pdf" ? page.source.docId : null);
  const [level, setLevel] = useState<Level>(page?.compress ?? "medium");
  useEffect(() => setLevel(page?.compress ?? "medium"), [page?.id, page?.compress]);
  const est = useEstimate(editor.plan, targets, level, targets.length > 0);
  if (!page) return null;

  const size = displaySize(page, docs);
  const anyOverride = editor.plan.pages.some((p) => targets.includes(p.id) && p.compress);
  const apply = () => {
    dispatch({ type: "setCompress", ids: targets, level });
    if (est.result) {
      const share = est.result.estimatedBytes / targets.length;
      setEstimates((e) => ({ ...e, ...Object.fromEntries(targets.map((id) => [id, share])) }));
    }
  };

  return (
    <>
      <section>
        <h3>Trang {index + 1}{targets.length > 1 ? ` (+${targets.length - 1} trang chọn)` : ""}</h3>
        {detail ? (
          <>
            <div className="kv"><span>Dung lượng</span><span style={{ color: detail.heavy ? "var(--warn)" : undefined, fontWeight: 600 }}>{formatBytes(detail.size)}</span></div>
            <div className="kv"><span>Loại trang</span><span>{KIND_LABEL[detail.kind]}</span></div>
            <div className="kv"><span>Khổ giấy</span><span>{paperName(size.width, size.height)}</span></div>
            <div className="kv"><span>Số ảnh</span><span>{detail.imageCount}</span></div>
            <div className="kv"><span>DPI cao nhất</span><span>{detail.maxDpi || "—"}</span></div>
            <div className="kv"><span>Font</span><span>{detail.fontCount}</span></div>
            {detail.images.map((x) => {
              const im = report?.images[String(x)];
              return im ? (
                <div key={x} className="small muted" style={{ marginTop: 4 }}>
                  Ảnh {im.width}×{im.height} · {im.dpi} DPI · {im.filter ?? "?"} · {formatBytes(im.size)}
                  {im.pages.length > 1 ? ` · dùng ở ${im.pages.length} trang` : ""}
                </div>
              ) : null;
            })}
          </>
        ) : (
          <div className="small muted">
            {page.source.type === "pdf" ? "Đang phân tích…" : page.source.type === "blank" ? "Trang trắng" : "Trang từ ảnh"}
          </div>
        )}
      </section>
      <section>
        <h3>Nén {targets.length > 1 ? `${targets.length} trang` : "trang này"}</h3>
        <div className="chips">
          {LEVELS.map((lv) => (
            <button key={lv} className={`chip${level === lv ? " on" : ""}`} onClick={() => setLevel(lv)}>{LEVEL_LABEL[lv]}</button>
          ))}
        </div>
        <div className="kv" style={{ marginTop: 10 }}>
          <span>Ước tính</span>
          <span style={{ fontWeight: 600 }} data-testid="page-estimate">
            {est.result ? `${formatBytes(est.result.originalBytes)} → ~${formatBytes(est.result.estimatedBytes)}` : est.loading ? "Đang tính…" : "—"}
          </span>
        </div>
        {est.error && <div className="error-text">{est.error}</div>}
        {editor.plan.fileCompression && (
          <div className="small muted" style={{ margin: "6px 0" }}>Mức riêng sẽ dùng thay cho mức nén toàn file ở các trang này.</div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" style={{ flex: 1 }} onClick={apply}>Áp dụng</button>
          {anyOverride && <button onClick={() => dispatch({ type: "setCompress", ids: targets, level: null })}>Bỏ mức riêng</button>}
        </div>
      </section>
    </>
  );
}
