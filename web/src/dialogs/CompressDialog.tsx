import { useMemo, useState } from "react";
import { useEstimate } from "../api/hooks";
import type { Advanced, Preset } from "../api/types";
import { buildFileCompression, effectivePreset, isManual, subsetPlan, validateCompression } from "../lib/dialogs";
import { PRESET_LABEL, formatBytes } from "../lib/format";
import { useApp, type ExportContext } from "../state/app";
import { countOverrides, withFileCompression } from "../state/plan";
import Modal from "./Modal";

const PRESETS: Preset[] = ["email", "zalo", "balanced", "high"];

export default function CompressDialog({ onlyIds, split }: ExportContext) {
  const { editor, dispatch, setDialog, health, setEstimates } = useApp();
  const current = editor.plan.fileCompression;
  const [preset, setPreset] = useState<Preset | null>(current ? current.preset ?? null : "email");
  const [target, setTarget] = useState<string>(current?.targetMB && !isManual(current.advanced ?? {}) ? String(current.targetMB) : "");
  const [showAdvanced, setShowAdvanced] = useState(!!current?.advanced && Object.values(current.advanced).some(Boolean));
  const [adv, setAdv] = useState<Advanced>(current?.advanced ?? {});

  const input = { preset, target, adv };
  const errors = validateCompression(input);
  const invalid = Object.keys(errors).length > 0;
  const manual = isManual(adv);
  const shownPreset = effectivePreset(input);
  const fc = useMemo(() => buildFileCompression({ preset, target, adv }), [preset, target, adv]);
  const overrides = countOverrides(editor.plan);
  const scope = subsetPlan(editor.plan, onlyIds);
  const preview = fc && scope.pages.length ? withFileCompression(scope, fc) : null;
  const est = useEstimate(preview, null, null, !!preview);

  const close = () => setDialog({ kind: "none" });
  const apply = (thenExport: boolean) => {
    if (!fc) return;
    dispatch({ type: "applyFileCompression", fc });
    setEstimates(() => ({}));
    setDialog(thenExport ? { kind: "export", onlyIds, split } : { kind: "none" });
  };
  const setNum = (key: "maxDpi" | "jpegQuality", v: string) => {
    const next = { ...adv, [key]: v.trim() ? Number(v) : null };
    setAdv(next);
    if (isManual(next)) setTarget(""); // manual DPI/JPEG replaces the size target
  };

  return (
    <Modal title="Nén toàn file" onClose={close} actions={<>
      {current && <button onClick={() => { dispatch({ type: "clearFileCompression" }); close(); }}>Bỏ nén toàn file</button>}
      <div className="spacer" />
      <button onClick={close}>Hủy</button>
      <button disabled={invalid} onClick={() => apply(false)}>Áp dụng</button>
      <button className="primary" disabled={invalid} onClick={() => apply(true)}>Nén và xuất…</button>
    </>}>
      <div className="chips" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {PRESETS.map((p) => (
          <button key={p} className={`chip${shownPreset === p ? " on" : ""}`}
            onClick={() => { setPreset(p); setTarget(""); }}>{PRESET_LABEL[p]}</button>
        ))}
      </div>
      <label className="field">
        Hoặc nén về dưới (MB)
        <input type="number" min={0.1} step={0.1} value={target} placeholder="ví dụ 10" disabled={manual}
          onChange={(e) => setTarget(e.target.value)} style={{ width: 140 }} aria-invalid={!!errors.target} />
        {manual && <span className="small muted">Đã đặt DPI/JPEG thủ công nên chế độ này tắt.</span>}
      </label>
      {errors.target && <div className="error-text">{errors.target}</div>}

      <button className="link" onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? "▾" : "▸"} Tùy chỉnh nâng cao
      </button>
      {showAdvanced && (
        <div style={{ marginTop: 6 }}>
          <div className="row">
            <label className="field">DPI tối đa<input type="number" min={36} max={1200} step={1} value={adv.maxDpi ?? ""} aria-invalid={!!errors.maxDpi} onChange={(e) => setNum("maxDpi", e.target.value)} style={{ width: 100 }} /></label>
            <label className="field">Chất lượng JPEG<input type="number" min={10} max={100} step={1} value={adv.jpegQuality ?? ""} aria-invalid={!!errors.jpegQuality} onChange={(e) => setNum("jpegQuality", e.target.value)} style={{ width: 100 }} /></label>
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

      {errors.maxDpi && <div className="error-text">{errors.maxDpi}</div>}
      {errors.jpegQuality && <div className="error-text">{errors.jpegQuality}</div>}

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
