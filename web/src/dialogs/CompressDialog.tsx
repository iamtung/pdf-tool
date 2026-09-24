import { useMemo, useState } from "react";
import { useEstimate } from "../api/hooks";
import type { Advanced, FileCompression, Preset } from "../api/types";
import { PRESET_LABEL, formatBytes } from "../lib/format";
import { useApp } from "../state/app";
import { countOverrides, withFileCompression } from "../state/plan";
import Modal from "./Modal";

const PRESETS: Preset[] = ["email", "zalo", "balanced", "high"];

export default function CompressDialog() {
  const { editor, dispatch, setDialog, health, setEstimates } = useApp();
  const current = editor.plan.fileCompression;
  const [preset, setPreset] = useState<Preset | null>(current?.preset ?? (current?.targetMB ? null : "email"));
  const [target, setTarget] = useState<string>(current?.targetMB ? String(current.targetMB) : "");
  const [showAdvanced, setShowAdvanced] = useState(!!current?.advanced && Object.values(current.advanced).some(Boolean));
  const [adv, setAdv] = useState<Advanced>(current?.advanced ?? {});
  const [error, setError] = useState<string | null>(null);

  const targetMB = target.trim() ? Number(target) : null;
  const manual = adv.maxDpi != null || adv.jpegQuality != null;
  const fc: FileCompression | null = useMemo(() => {
    if (targetMB !== null && !(targetMB > 0)) return null;
    return { preset: targetMB ? null : preset, targetMB, advanced: adv };
  }, [preset, targetMB, adv]);
  const overrides = countOverrides(editor.plan);
  const preview = fc ? withFileCompression(editor.plan, fc) : null;
  const est = useEstimate(preview, null, null, !!preview);

  const close = () => setDialog({ kind: "none" });
  const apply = (thenExport: boolean) => {
    if (!fc) {
      setError("Nhập dung lượng mục tiêu lớn hơn 0.");
      return;
    }
    dispatch({ type: "applyFileCompression", fc });
    setEstimates(() => ({}));
    setDialog(thenExport ? { kind: "export" } : { kind: "none" });
  };
  const setNum = (key: "maxDpi" | "jpegQuality", v: string) => setAdv({ ...adv, [key]: v ? Number(v) : null });

  return (
    <Modal title="Nén toàn file" onClose={close} actions={<>
      {current && <button onClick={() => { dispatch({ type: "clearFileCompression" }); close(); }}>Bỏ nén toàn file</button>}
      <div className="spacer" />
      <button onClick={close}>Hủy</button>
      <button onClick={() => apply(false)}>Áp dụng</button>
      <button className="primary" onClick={() => apply(true)}>Nén và xuất…</button>
    </>}>
      <div className="chips" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {PRESETS.map((p) => (
          <button key={p} className={`chip${preset === p && !targetMB ? " on" : ""}`}
            onClick={() => { setPreset(p); setTarget(""); setError(null); }}>{PRESET_LABEL[p]}</button>
        ))}
      </div>
      <label className="field">
        Hoặc nén về dưới (MB)
        <input type="number" min={0.1} step={0.1} value={target} placeholder="ví dụ 10" disabled={manual}
          onChange={(e) => { setTarget(e.target.value); setError(null); }} style={{ width: 140 }} />
        {manual && <span className="small muted">Đã đặt DPI/JPEG thủ công nên chế độ này tắt.</span>}
      </label>
      {error && <div className="error-text">{error}</div>}

      <button className="link" onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? "▾" : "▸"} Tùy chỉnh nâng cao
      </button>
      {showAdvanced && (
        <div style={{ marginTop: 6 }}>
          <div className="row">
            <label className="field">DPI tối đa<input type="number" min={36} max={1200} value={adv.maxDpi ?? ""} onChange={(e) => setNum("maxDpi", e.target.value)} style={{ width: 100 }} /></label>
            <label className="field">Chất lượng JPEG<input type="number" min={10} max={100} value={adv.jpegQuality ?? ""} onChange={(e) => setNum("jpegQuality", e.target.value)} style={{ width: 100 }} /></label>
          </div>
          <label className="row small"><input type="checkbox" checked={!!adv.grayscaleScans} onChange={(e) => setAdv({ ...adv, grayscaleScans: e.target.checked })} /> Chuyển ảnh xám cho trang scan gần như không màu</label>
          <label className="row small"><input type="checkbox" checked={!!adv.stripMetadata} onChange={(e) => setAdv({ ...adv, stripMetadata: e.target.checked })} /> Bỏ metadata</label>
          <label className="row small">
            <input type="checkbox" disabled={!health?.ghostscript} checked={!!adv.useGhostscript} onChange={(e) => setAdv({ ...adv, useGhostscript: e.target.checked })} />
            Dùng Ghostscript (nén mạnh nhất, có thể đổi font/màu)
          </label>
          {!health?.ghostscript && <div className="small muted">Chưa cài Ghostscript: <code>brew install ghostscript</code></div>}
        </div>
      )}

      <div className="kv" style={{ marginTop: 14 }}>
        <span>Ước tính</span>
        <span style={{ fontWeight: 600 }} data-testid="file-estimate">
          {est.result ? `${formatBytes(est.result.originalBytes)} → ~${formatBytes(est.result.estimatedBytes)}` : est.loading ? "Đang tính…" : "—"}
        </span>
      </div>
      {est.result?.targetMet === false && <div className="warning">Có thể không đạt mục tiêu. Nếu vẫn lớn hơn, công cụ sẽ gợi ý tách thành nhiều phần.</div>}
      {est.error && <div className="error-text">{est.error}</div>}
      {overrides > 0 && (
        <div className="warning" style={{ marginTop: 8 }} data-testid="override-warning">
          {overrides} trang đang có mức nén riêng sẽ được thay bằng mức chung.
        </div>
      )}
    </Modal>
  );
}
