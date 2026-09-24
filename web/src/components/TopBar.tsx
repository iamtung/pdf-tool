import { useAnalysis } from "../api/hooks";
import { describeFileCompression, formatBytes, percent } from "../lib/format";
import { usePickAndOpen } from "../state/actions";
import { useApp } from "../state/app";

export default function TopBar() {
  const { primary, editor, dispatch, setDialog } = useApp();
  const { report } = useAnalysis(primary?.docId ?? null);
  const pickAndOpen = usePickAndOpen();
  const fc = editor.plan.fileCompression;
  const comp = report?.composition;

  return (
    <header className="topbar">
      {primary ? (
        <div style={{ minWidth: 0 }}>
          <div className="row">
            <span className="title">{primary.name}</span>
            {editor.dirty && <span className="dirty-dot" title="Có thay đổi chưa xuất" />}
          </div>
          <div className="small muted">
            {formatBytes(primary.size)} · {editor.plan.pages.length} trang
            {comp && ` · ảnh ${percent(comp.images, report.size)}, font ${percent(comp.fonts, report.size)}`}
          </div>
        </div>
      ) : (
        <span className="title">PDF Tool</span>
      )}
      <div className="spacer" />
      {fc && <span className="badge">Nén: {describeFileCompression(fc)}</span>}
      <button onClick={pickAndOpen}>Mở file…</button>
      <button className="icon" title="Hoàn tác (⌘Z)" disabled={!editor.past.length} onClick={() => dispatch({ type: "undo" })}>↶</button>
      <button className="icon" title="Làm lại (⇧⌘Z)" disabled={!editor.future.length} onClick={() => dispatch({ type: "redo" })}>↷</button>
      <button disabled={!primary || !editor.plan.pages.length} onClick={() => setDialog({ kind: "export" })}>Xuất file</button>
      <button className="primary" disabled={!primary || !editor.plan.pages.length} onClick={() => setDialog({ kind: "compress" })}>Nén toàn file</button>
    </header>
  );
}
