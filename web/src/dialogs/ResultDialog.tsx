import { useQuery } from "@tanstack/react-query";
import { FolderSearch } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useJob, usePageImage } from "../api/hooks";
import type { ExportResult, Plan } from "../api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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
    <div className="mt-3.5">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span>So sánh trang</span>
        <Input type="number" min={1} max={max} value={current} className="w-[70px]"
          onChange={(e) => setPage(Math.max(1, Math.min(max, Math.floor(Number(e.target.value)) || 1)))} />
        <span className="text-muted-foreground">/ {max}</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setZoom(zoom === 1 ? 2.5 : 1)}>
          {zoom === 1 ? "Phóng to" : "Thu nhỏ"}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Trước</div>
          <div className="max-h-[55vh] overflow-auto rounded-md border bg-muted/40">
            {before && <RotatedImage src={before} rotate={planPage.rotate} width={paneW} height={beforeH} alt="Trước" />}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Sau</div>
          <div className="max-h-[55vh] overflow-auto rounded-md border bg-muted/40">
            {after && <img src={after} style={{ width: paneW }} alt="Sau" />}
          </div>
        </div>
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
      <Modal title="Đang xuất file" actions={<Button variant="outline" onClick={() => void api.cancelJob(jobId).catch(() => {})}>Hủy</Button>}>
        <div className="mb-2 text-xs text-muted-foreground">{job?.message || "Đang chuẩn bị…"}</div>
        <Progress value={job?.progress ?? 2} />
      </Modal>
    );
  }
  if (job.status !== "done" || !job.result) {
    return (
      <Modal title={job.status === "cancelled" ? "Đã hủy" : "Xuất file thất bại"} onClose={close}
        actions={<Button onClick={close}>Đóng</Button>}>
        <p className="text-sm">{job.status === "cancelled" ? "Đã dừng và xóa file tạm." : job.error?.message}</p>
      </Modal>
    );
  }

  const r = job.result;
  const saved = r.originalSize ? Math.round((1 - r.resultSize / r.originalSize) * 100) : 0;
  const targetMB = plan.fileCompression?.targetMB ?? (plan.fileCompression?.preset === "email" ? 20 : null);
  const reveal = () => api.reveal(r.outputs[0].path).catch(showError);
  return (
    <Modal title="Đã xuất file" wide onClose={close}
      actions={<>
        {r.outputs.length > 0 && <Button variant="outline" onClick={reveal}><FolderSearch /> Hiện trong Finder</Button>}
        <Button variant="outline" onClick={() => setDialog({ kind: "compress", onlyIds, split })}>Nén lại mức khác</Button>
        {(r.splitSuggestion || r.targetMet === false) && (
          <Button variant="outline" onClick={() => setDialog({ kind: "split", maxMB: targetMB ?? 20, onlyIds })}>Tách thành nhiều phần</Button>
        )}
        <Button onClick={close}>Đóng</Button>
      </>}>
      <div className="text-xl font-semibold" data-testid="result-sizes">
        {formatBytes(r.originalSize)} → {formatBytes(r.resultSize)}
        {saved > 0 && <Badge variant="secondary" className="ml-2.5">−{saved}%</Badge>}
      </div>
      {r.level && <div className="text-xs text-muted-foreground">Mức dùng: {r.level.maxDpi} DPI, JPEG {r.level.quality}</div>}
      {r.targetMet === false && (
        <div className="mt-2 rounded-md bg-amber-100 px-2.5 py-2 text-xs leading-relaxed text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Chưa đạt dung lượng mục tiêu. Gợi ý tách thành {r.splitSuggestion} phần.
        </div>
      )}
      {[...r.notes, ...r.warnings].map((n, i) => (
        <div key={i} className="mt-1.5 rounded-md bg-accent px-2.5 py-2 text-xs leading-relaxed text-accent-foreground">{n}</div>
      ))}
      <div className="mt-2.5">
        {r.outputs.map((o) => (
          <div key={o.path} className="flex items-center justify-between gap-3 py-0.5 text-[13px]">
            <code className="text-xs">{o.name}</code><span>{formatBytes(o.size)}</span>
          </div>
        ))}
      </div>
      {canCompare(r.outputs.length, split) && <Compare plan={plan} outputPath={r.outputs[0].path} />}
    </Modal>
  );
}
