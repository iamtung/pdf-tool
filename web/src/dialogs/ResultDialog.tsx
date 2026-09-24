import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useJob, usePageImage } from "../api/hooks";
import type { ExportResult, Plan } from "../api/types";
import RotatedImage from "../components/RotatedImage";
import { canCompare, isFullExport } from "../lib/dialogs";
import { formatBytes } from "../lib/format";
import { displaySize } from "../lib/pages";
import { useApp, type ExportContext } from "../state/app";
import Modal from "./Modal";

function Compare({ plan, outputPath }: { plan: Plan; outputPath: string }) {
  const { docs } = useApp();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const out = useQuery({ queryKey: ["output-doc", outputPath], queryFn: () => api.openDoc(outputPath), staleTime: Infinity, gcTime: 0 });
  useEffect(() => {
    if (!out.data) return;
    const docId = out.data.docId;
    return () => {
      api.closeDoc(docId).catch(() => {});
    };
  }, [out.data]);
  const max = Math.max(1, Math.min(plan.pages.length, out.data?.pageCount ?? plan.pages.length));
  const current = Math.min(page, max);
  const planPage = plan.pages[current - 1];
  const scale = zoom * 0.8;
  const before = usePageImage(planPage.source, Math.round(420 * zoom), scale);
  const after = out.data && current <= out.data.pageCount ? api.renderUrl(out.data.docId, current - 1, scale) : null;
  // Both panes are drawn at the same on-screen width; the "before" pane rotates the source page.
  const paneW = 360 * zoom;
  const shown = displaySize(planPage, docs);
  const beforeH = (paneW * shown.height) / shown.width;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small">So sánh trang</span>
        <input type="number" min={1} max={max} value={current} style={{ width: 70 }}
          onChange={(e) => setPage(Math.max(1, Math.min(max, Math.floor(Number(e.target.value)) || 1)))} />
        <span className="small muted">/ {max}</span>
        <div className="spacer" />
        <button onClick={() => setZoom(zoom === 1 ? 2.5 : 1)}>{zoom === 1 ? "Phóng to" : "Thu nhỏ"}</button>
      </div>
      <div className="compare">
        <div><div className="small muted">Trước</div><div className="pane">
          {before && (
            <RotatedImage src={before} rotate={planPage.rotate} width={paneW} height={beforeH} alt="Trước" />
          )}
        </div></div>
        <div><div className="small muted">Sau</div><div className="pane">{after && <img src={after} style={{ width: paneW }} alt="Sau" />}</div></div>
      </div>
    </div>
  );
}

export default function ResultDialog({ jobId, plan, onlyIds, split }: { jobId: string; plan: Plan } & ExportContext) {
  const { dispatch, setDialog, showError } = useApp();
  const job = useJob<ExportResult>(jobId);
  const close = () => setDialog({ kind: "none" });
  const done = job?.status === "done";
  // Only an export that wrote every page of the document counts as saving it.
  const full = isFullExport(onlyIds, split, plan.pages.length);
  useEffect(() => {
    if (done && full) dispatch({ type: "markSaved" });
  }, [done, full, dispatch]);

  if (!job || job.status === "queued" || job.status === "running") {
    return (
      <Modal title="Đang xuất file" actions={<button onClick={() => void api.cancelJob(jobId).catch(() => {})}>Hủy</button>}>
        <div className="small muted" style={{ marginBottom: 8 }}>{job?.message || "Đang chuẩn bị…"}</div>
        <div className="progress"><div style={{ width: `${job?.progress ?? 2}%` }} /></div>
      </Modal>
    );
  }
  if (job.status !== "done" || !job.result) {
    return (
      <Modal title={job.status === "cancelled" ? "Đã hủy" : "Xuất file thất bại"} onClose={close}
        actions={<button className="primary" onClick={close}>Đóng</button>}>
        <p>{job.status === "cancelled" ? "Đã dừng và xóa file tạm." : job.error?.message}</p>
      </Modal>
    );
  }

  const r = job.result;
  const saved = r.originalSize ? Math.round((1 - r.resultSize / r.originalSize) * 100) : 0;
  const targetMB = plan.fileCompression?.targetMB ?? (plan.fileCompression?.preset === "email" ? 20 : null);
  const reveal = () => api.reveal(r.outputs[0].path).catch(showError);
  return (
    <Modal title="Đã xuất file" wide onClose={close} actions={<>
      {r.outputs.length > 0 && <button onClick={reveal}>Hiện trong Finder</button>}
      <button onClick={() => setDialog({ kind: "compress", onlyIds, split })}>Nén lại mức khác</button>
      {(r.splitSuggestion || r.targetMet === false) && (
        <button onClick={() => setDialog({ kind: "split", maxMB: targetMB ?? 20, onlyIds })}>Tách thành nhiều phần</button>
      )}
      <button className="primary" onClick={close}>Đóng</button>
    </>}>
      <div style={{ fontSize: 20, fontWeight: 600 }} data-testid="result-sizes">
        {formatBytes(r.originalSize)} → {formatBytes(r.resultSize)}
        {saved > 0 && <span className="badge" style={{ marginLeft: 10 }}>−{saved}%</span>}
      </div>
      {r.level && <div className="small muted">Mức dùng: {r.level.maxDpi} DPI, JPEG {r.level.quality}</div>}
      {r.targetMet === false && (
        <div className="warning" style={{ marginTop: 8 }}>
          Chưa đạt dung lượng mục tiêu. Gợi ý tách thành {r.splitSuggestion} phần.
        </div>
      )}
      {[...r.notes, ...r.warnings].map((n, i) => <div key={i} className="hint" style={{ marginTop: 6 }}>{n}</div>)}
      <div style={{ marginTop: 10 }}>
        {r.outputs.map((o) => <div key={o.path} className="kv"><code className="small">{o.name}</code><span>{formatBytes(o.size)}</span></div>)}
      </div>
      {canCompare(r.outputs.length, split) && <Compare plan={plan} outputPath={r.outputs[0].path} />}
    </Modal>
  );
}
