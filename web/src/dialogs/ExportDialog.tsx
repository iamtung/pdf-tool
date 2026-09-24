import { useState } from "react";
import { api } from "../api/client";
import type { SplitOption } from "../api/types";
import { Button } from "@/components/ui/button";
import { defaultDestination, subsetPlan } from "../lib/dialogs";
import { describeFileCompression } from "../lib/format";
import { useStartExport } from "../state/actions";
import { useApp } from "../state/app";
import { countOverrides } from "../state/plan";
import Kv from "../components/Kv";
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
    <Modal title={onlyIds ? `Trích ${exportPlan.pages.length} trang` : "Xuất file"} onClose={busy ? undefined : close}
      actions={<>
        <Button variant="outline" onClick={close} disabled={busy}>Hủy</Button>
        <Button disabled={busy || empty} onClick={run}>{busy ? "Đang bắt đầu…" : "Xuất"}</Button>
      </>}>
      <Kv label="Số trang">{exportPlan.pages.length}</Kv>
      <Kv label="Nén toàn file">{fc ? describeFileCompression(fc) : "Không"}</Kv>
      <Kv label="Trang có mức riêng">{overrides}</Kv>
      {split && <Kv label="Tách">{split.mode === "ranges" ? split.ranges : `mỗi phần ≤ ${split.maxMB} MB`}</Kv>}
      <div className="mt-3 space-y-1">
        <div className="text-[13px] text-muted-foreground">Lưu vào</div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate text-xs">{destDir ?? defaultDir}</code>
          <Button variant="outline" onClick={pick} disabled={busy}>Đổi…</Button>
        </div>
      </div>
      {empty && <div className="mt-2 text-xs text-destructive">Không có trang nào để xuất.</div>}
      {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
      {encrypted && (
        <div className="mt-2 rounded-md bg-amber-100 px-2.5 py-2 text-xs leading-relaxed text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          File gốc có mật khẩu. File xuất ra sẽ không có mật khẩu.
        </div>
      )}
      {fc?.advanced?.useGhostscript && overrides > 0 && (
        <div className="mt-2 rounded-md bg-amber-100 px-2.5 py-2 text-xs leading-relaxed text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Ghostscript nén đồng đều cả file; mức riêng của {overrides} trang sẽ không được áp dụng.
        </div>
      )}
    </Modal>
  );
}
