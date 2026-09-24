import { useState } from "react";
import { parseRanges, subsetPlan } from "../lib/dialogs";
import { useApp } from "../state/app";
import Modal from "./Modal";

export default function SplitDialog({ ranges: initialRanges, maxMB: initialMax, onlyIds }: {
  ranges?: string; maxMB?: number; onlyIds?: string[];
}) {
  const { editor, setDialog } = useApp();
  // Ranges are 1-based over the exported plan, i.e. over the subset when onlyIds is set.
  const n = subsetPlan(editor.plan, onlyIds).pages.length;
  const [mode, setMode] = useState<"ranges" | "size">(initialMax ? "size" : "ranges");
  const [ranges, setRanges] = useState(initialRanges ?? (n > 1 ? `1-${n}` : "1"));
  const [maxMB, setMaxMB] = useState(String(initialMax ?? 20));
  const parsed = parseRanges(ranges, n);
  const error = n < 1
    ? "Không có trang nào để tách."
    : mode === "ranges"
      ? ("error" in parsed ? parsed.error : null)
      : !(Number(maxMB) > 0) ? "Dung lượng mỗi phần phải lớn hơn 0." : null;
  const close = () => setDialog({ kind: "none" });
  const next = () => {
    if (error) return;
    setDialog({
      kind: "export", onlyIds,
      split: mode === "ranges" ? { mode, ranges: ranges.trim() } : { mode, maxMB: Number(maxMB) },
    });
  };
  return (
    <Modal title="Tách file" onClose={close} actions={<><button onClick={close}>Hủy</button><button className="primary" disabled={!!error} onClick={next}>Tiếp tục…</button></>}>
      <label className="row"><input type="radio" checked={mode === "ranges"} onChange={() => setMode("ranges")} /> Theo khoảng trang</label>
      {mode === "ranges" && (
        <label className="field">
          Khoảng trang (1–{n}{onlyIds ? ", tính trên các trang đã chọn" : ""}), mỗi khoảng thành một file. Trang không nằm trong khoảng nào sẽ không được xuất.
          <input value={ranges} onChange={(e) => setRanges(e.target.value)} aria-invalid={mode === "ranges" && !!error} />
        </label>
      )}
      <label className="row" style={{ marginTop: 8 }}><input type="radio" checked={mode === "size"} onChange={() => setMode("size")} /> Theo dung lượng tối đa mỗi phần</label>
      {mode === "size" && (
        <label className="field">
          Tối đa mỗi phần (MB)
          <input type="number" min={0.1} step={0.1} value={maxMB} style={{ width: 120 }} aria-invalid={mode === "size" && !!error}
            onChange={(e) => setMaxMB(e.target.value)} />
        </label>
      )}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  );
}
