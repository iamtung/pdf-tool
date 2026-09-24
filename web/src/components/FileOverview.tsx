import { useAnalysis } from "../api/hooks";
import { Progress } from "@/components/ui/progress";
import { KIND_LABEL, formatBytes, percent } from "../lib/format";
import { useApp } from "../state/app";
import Kv from "./Kv";

const PARTS = [
  ["images", "Ảnh", "var(--part-images)"],
  ["fonts", "Font", "var(--part-fonts)"],
  ["content", "Nội dung trang", "var(--part-content)"],
  ["other", "Khác", "var(--part-other)"],
] as const;

export default function FileOverview() {
  const { primary, editor, setCurrentId, setSelected } = useApp();
  const { report, job, error } = useAnalysis(primary?.docId ?? null);
  if (!primary) return null;
  if (error) return <div className="pt-2 text-xs text-destructive">Không phân tích được: {error.message}</div>;
  if (!report) {
    return (
      <section className="pt-1">
        <h3 className="mb-1.5 text-sm font-semibold">Phân tích</h3>
        <div className="text-xs text-muted-foreground">{job?.message || "Đang phân tích…"}</div>
        <Progress className="mt-2" value={job?.progress ?? 5} />
      </section>
    );
  }
  const total = report.size || 1;
  const goTo = (pageIndex: number) => {
    const p = editor.plan.pages.find(
      (pp) => pp.source.type === "pdf" && pp.source.docId === primary.docId && pp.source.index === pageIndex,
    );
    if (p) {
      setCurrentId(p.id);
      setSelected(new Set([p.id]));
    }
  };
  const heavy = report.pagesDetail.filter((p) => p.heavy);

  return (
    <div className="space-y-3 pt-1">
      <section>
        <h3 className="mb-1.5 text-sm font-semibold">Phân tích cả file</h3>
        <div className="my-1.5 flex h-2.5 overflow-hidden rounded-full bg-muted">
          {PARTS.map(([k, , color]) => (
            <div key={k} style={{ width: percent(report.composition[k], total), background: color }} />
          ))}
        </div>
        {PARTS.map(([k, label, color]) => (
          <Kv key={k} label={<><span style={{ color }}>■</span> {label}</>}>
            {formatBytes(report.composition[k])} · {percent(report.composition[k], total)}
          </Kv>
        ))}
        <Kv label="Loại trang" className="mt-1.5">
          {(["scan", "image_heavy", "vector"] as const)
            .map((k) => `${KIND_LABEL[k]} ${report.kinds[k] ?? 0}`).join(" · ")}
        </Kv>
        {heavy.length > 0 && <Kv label="Trang nặng bất thường">{heavy.length}</Kv>}
      </section>
      {report.suggestions.length > 0 && (
        <section className="border-t pt-3">
          <h3 className="mb-1.5 text-sm font-semibold">Gợi ý</h3>
          {report.suggestions.map((s, i) => (
            <div key={i} className="mb-1.5 rounded-md bg-accent px-2.5 py-2 text-xs leading-relaxed text-accent-foreground">
              {s}
            </div>
          ))}
        </section>
      )}
      <section className="border-t pt-3">
        <h3 className="mb-1.5 text-sm font-semibold">Ảnh nặng nhất</h3>
        {report.topImages.map((im) => (
          <Kv key={im.xref} label={
            <button className="text-left text-primary hover:underline" onClick={() => goTo(im.pages[0])}>
              Trang {im.pages.map((p) => p + 1).slice(0, 3).join(", ")}{im.pages.length > 3 ? "…" : ""}
            </button>
          }>
            <span className="text-xs">{im.width}×{im.height} · {im.dpi} DPI · {formatBytes(im.size)}</span>
          </Kv>
        ))}
        {!report.topImages.length && <div className="text-xs text-muted-foreground">File không có ảnh.</div>}
      </section>
    </div>
  );
}
