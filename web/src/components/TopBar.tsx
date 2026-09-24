import { Download, FolderOpen, Minimize2, Redo2, Undo2 } from "lucide-react";
import { useAnalysis, useProfileEstimate } from "../api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeFileCompression, formatBytes, percent } from "../lib/format";
import { usePickAndOpen } from "../state/actions";
import { useApp } from "../state/app";
import IconButton from "./IconButton";

export default function TopBar() {
  const { primary, editor, dispatch, setDialog } = useApp();
  const { report } = useAnalysis(primary?.docId ?? null);
  const { profile: primaryProfile, error: profileError } = useProfileEstimate(primary?.docId ?? null);
  const pickAndOpen = usePickAndOpen();
  const fc = editor.plan.fileCompression;
  const comp = report?.composition;
  const profileState = !primary ? null : primaryProfile ? "ready" : profileError ? "error" : "computing";

  return (
    <header className="flex items-center gap-2.5 border-b bg-card px-3.5 py-2.5">
      {primary ? (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{primary.name}</span>
            {editor.dirty && <span className="inline-block size-2 rounded-full bg-amber-500" title="Có thay đổi chưa xuất" />}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(primary.size)} · {editor.plan.pages.length} trang
            {comp && ` · ảnh ${percent(comp.images, report.size)}, font ${percent(comp.fonts, report.size)}`}
          </div>
        </div>
      ) : (
        <span className="font-semibold">PDF Tool</span>
      )}
      <div className="flex-1" />
      {profileState && (
        <span data-testid="profile-status" data-state={profileState} className="text-xs text-muted-foreground">
          {profileState === "computing" ? "Đang chuẩn bị ước tính…" : ""}
        </span>
      )}
      {fc && <Badge variant="secondary">Nén: {describeFileCompression(fc)}</Badge>}
      <Button variant="outline" onClick={pickAndOpen}>
        <FolderOpen /> Mở file…
      </Button>
      <IconButton label="Hoàn tác" icon={Undo2} disabled={!editor.past.length} onClick={() => dispatch({ type: "undo" })} />
      <IconButton label="Làm lại" icon={Redo2} disabled={!editor.future.length} onClick={() => dispatch({ type: "redo" })} />
      <Button variant="outline" disabled={!primary || !editor.plan.pages.length} onClick={() => setDialog({ kind: "export" })}>
        <Download /> Xuất file
      </Button>
      <Button disabled={!primary || !editor.plan.pages.length} onClick={() => setDialog({ kind: "compress" })}>
        <Minimize2 /> Nén toàn file
      </Button>
    </header>
  );
}
