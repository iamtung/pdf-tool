import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useJob, usePageImage } from "../api/hooks";
import type { ExportResult, Plan } from "../api/types";
import { formatBytes } from "../lib/format";
import { useApp } from "../state/app";
import Modal from "./Modal";

function Compare({ plan, outputPath }: { plan: Plan; outputPath: string }) {
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
  const planPage = plan.pages[page - 1];
  const before = usePageImage(planPage.source, Math.round(420 * zoom), zoom * 0.8);
  const after = out.data ? api.renderUrl(out.data.docId, page - 1, zoom * 0.8) : null;
  const imgStyle = { width: `${100 * zoom}%`, transform: planPage.rotate ? `rotate(${planPage.rotate}deg)` : undefined };
  return (
    <div style={{ marginTop: 14 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small">So sánh trang</span>
        <input type="number" min={1} max={plan.pages.length} value={page} style={{ width: 70 }}
          onChange={(e) => setPage(Math.max(1, Math.min(plan.pages.length, Number(e.target.value) || 1)))} />
        <span className="small muted">/ {plan.pages.length}</span>
        <div className="spacer" />
        <button onClick={() => setZoom(zoom === 1 ? 2.5 : 1)}>{zoom === 1 ? "Phóng to" : "Thu nhỏ"}</button>
      </div>
      <div className="compare">
        <div><div className="small muted">Trước</div><div className="pane">{before && <img src={before} style={imgStyle} alt="Trước" />}</div></div>
        <div><div className="small muted">Sau</div><div className="pane">{after && <img src={after} style={{ width: `${100 * zoom}%` }} alt="Sau" />}</div></div>
      </div>
    </div>
  );
}

export default function ResultDialog({ jobId, plan }: { jobId: string; plan: Plan }) {
  const { dispatch, setDialog, editor } = useApp();
  const job = useJob<ExportResult>(jobId);
  const close = () => setDialog({ kind: "none" });
  const done = job?.status === "done";
  useEffect(() => {
    if (done) dispatch({ type: "markSaved" });
  }, [done, dispatch]);

  if (!job || job.status === "queued" || job.status === "running") {
    return (
      <Modal title="Đang xuất file" actions={<button onClick={() => api.cancelJob(jobId)}>Hủy</button>}>
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
  const targetMB = editor.plan.fileCompression?.targetMB ?? (editor.plan.fileCompression?.preset === "email" ? 20 : null);
  return (
    <Modal title="Đã xuất file" wide onClose={close} actions={<>
      <button onClick={() => api.reveal(r.outputs[0].path)}>Hiện trong Finder</button>
      <button onClick={() => setDialog({ kind: "compress" })}>Nén lại mức khác</button>
      {(r.splitSuggestion || r.targetMet === false) && (
        <button onClick={() => setDialog({ kind: "split", maxMB: targetMB ?? 20 })}>Tách thành nhiều phần</button>
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
      {r.outputs.length === 1 && <Compare plan={plan} outputPath={r.outputs[0].path} />}
    </Modal>
  );
}
