import { useState } from "react";
import { api } from "../api/client";
import type { SplitOption } from "../api/types";
import { defaultDestination, subsetPlan } from "../lib/dialogs";
import { describeFileCompression } from "../lib/format";
import { useStartExport } from "../state/actions";
import { useApp } from "../state/app";
import { countOverrides } from "../state/plan";
import Modal from "./Modal";

export default function ExportDialog({ split, onlyIds }: { split: SplitOption | null; onlyIds?: string[] }) {
  const { editor, docs, setDialog } = useApp();
  const startExport = useStartExport();
  const [destDir, setDestDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportPlan = subsetPlan(editor.plan, onlyIds);
  const fc = exportPlan.fileCompression;
  const overrides = countOverrides(exportPlan);
  const usedDocs = [...new Set(exportPlan.pages.flatMap((p) => (p.source.type === "pdf" ? [p.source.docId] : [])))];
  const encrypted = usedDocs.some((d) => docs[d]?.encrypted);
  const defaultDir = defaultDestination(exportPlan, docs);
  const empty = exportPlan.pages.length === 0;
  const close = () => setDialog({ kind: "none" });
  const pick = async () => {
    setError(null);
    try {
      const { path } = await api.pickFolder();
      if (path) setDestDir(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const run = async () => {
    if (busy || empty) return;
    setBusy(true);
    // On success the dialog is replaced by the result dialog; on failure showError replaces it too.
    const ok = await startExport(exportPlan, { destDir, split, onlyIds });
    if (!ok) setBusy(false);
  };

  return (
    <Modal title={onlyIds ? `Trích ${exportPlan.pages.length} trang` : "Xuất file"} onClose={busy ? undefined : close} actions={<>
      <button onClick={close} disabled={busy}>Hủy</button>
      <button className="primary" disabled={busy || empty} onClick={run}>{busy ? "Đang bắt đầu…" : "Xuất"}</button>
    </>}>
      <div className="kv"><span>Số trang</span><span>{exportPlan.pages.length}</span></div>
      <div className="kv"><span>Nén toàn file</span><span>{fc ? describeFileCompression(fc) : "Không"}</span></div>
      <div className="kv"><span>Trang có mức riêng</span><span>{overrides}</span></div>
      {split && <div className="kv"><span>Tách</span><span>{split.mode === "ranges" ? split.ranges : `mỗi phần ≤ ${split.maxMB} MB`}</span></div>}
      <div className="field">
        Lưu vào
        <div className="row"><code className="small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{destDir ?? defaultDir}</code><button onClick={pick} disabled={busy}>Đổi…</button></div>
      </div>
      {empty && <div className="error-text">Không có trang nào để xuất.</div>}
      {error && <div className="error-text">{error}</div>}
      {encrypted && <div className="warning">File gốc có mật khẩu. File xuất ra sẽ không có mật khẩu.</div>}
      {fc?.advanced?.useGhostscript && overrides > 0 && (
        <div className="warning" style={{ marginTop: 6 }}>Ghostscript nén đồng đều cả file; mức riêng của {overrides} trang sẽ không được áp dụng.</div>
      )}
    </Modal>
  );
}
