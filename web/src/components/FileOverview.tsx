import { useAnalysis } from "../api/hooks";
import { KIND_LABEL, formatBytes, percent } from "../lib/format";
import { useApp } from "../state/app";

const PARTS = [
  ["images", "Ảnh", "var(--img)"],
  ["fonts", "Font", "var(--font)"],
  ["content", "Nội dung trang", "var(--content)"],
  ["other", "Khác", "var(--other)"],
] as const;

export default function FileOverview() {
  const { primary, editor, setCurrentId, setSelected } = useApp();
  const { report, job, error } = useAnalysis(primary?.docId ?? null);
  if (!primary) return null;
  if (error) return <div className="error-text">Không phân tích được: {error.message}</div>;
  if (!report) {
    return (
      <section>
        <h3>Phân tích</h3>
        <div className="small muted">{job?.message || "Đang phân tích…"}</div>
        <div className="progress" style={{ marginTop: 8 }}><div style={{ width: `${job?.progress ?? 5}%` }} /></div>
      </section>
    );
  }
  const total = report.size || 1;
  const goTo = (pageIndex: number) => {
    const p = editor.plan.pages.find((pp) => pp.source.type === "pdf" && pp.source.docId === primary.docId && pp.source.index === pageIndex);
    if (p) {
      setCurrentId(p.id);
      setSelected(new Set([p.id]));
    }
  };
  const heavy = report.pagesDetail.filter((p) => p.heavy);

  return (
    <>
      <section>
        <h3>Phân tích cả file</h3>
        <div className="bar">
          {PARTS.map(([k, , color]) => (
            <div key={k} style={{ width: percent(report.composition[k], total), background: color }} />
          ))}
        </div>
        {PARTS.map(([k, label, color]) => (
          <div key={k} className="kv">
            <span><span style={{ color }}>■</span> {label}</span>
            <span>{formatBytes(report.composition[k])} · {percent(report.composition[k], total)}</span>
          </div>
        ))}
        <div className="kv" style={{ marginTop: 6 }}>
          <span>Loại trang</span>
          <span>{(["scan", "image_heavy", "vector"] as const).map((k) => `${KIND_LABEL[k]} ${report.kinds[k] ?? 0}`).join(" · ")}</span>
        </div>
        {heavy.length > 0 && <div className="kv"><span>Trang nặng bất thường</span><span>{heavy.length}</span></div>}
      </section>
      {report.suggestions.length > 0 && (
        <section>
          <h3>Gợi ý</h3>
          {report.suggestions.map((s, i) => <div key={i} className="hint" style={{ marginBottom: 6 }}>{s}</div>)}
        </section>
      )}
      <section>
        <h3>Ảnh nặng nhất</h3>
        {report.topImages.map((im) => (
          <div key={im.xref} className="kv">
            <button className="link" onClick={() => goTo(im.pages[0])}>
              Trang {im.pages.map((p) => p + 1).slice(0, 3).join(", ")}{im.pages.length > 3 ? "…" : ""}
            </button>
            <span className="small">{im.width}×{im.height} · {im.dpi} DPI · {formatBytes(im.size)}</span>
          </div>
        ))}
        {!report.topImages.length && <div className="small muted">File không có ảnh.</div>}
      </section>
    </>
  );
}
