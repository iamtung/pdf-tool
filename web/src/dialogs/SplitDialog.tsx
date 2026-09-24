import { useState } from "react";
import { useApp } from "../state/app";
import Modal from "./Modal";

export default function SplitDialog({ ranges: initialRanges, maxMB: initialMax }: { ranges?: string; maxMB?: number }) {
  const { editor, setDialog } = useApp();
  const n = editor.plan.pages.length;
  const [mode, setMode] = useState<"ranges" | "size">(initialMax ? "size" : "ranges");
  const [ranges, setRanges] = useState(initialRanges ?? `1-${n}`);
  const [maxMB, setMaxMB] = useState(String(initialMax ?? 20));
  const [error, setError] = useState<string | null>(null);
  const close = () => setDialog({ kind: "none" });
  const next = () => {
    if (mode === "ranges" && !/^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/.test(ranges)) {
      setError("Nhập khoảng trang dạng 1-10, 11-50.");
      return;
    }
    if (mode === "size" && !(Number(maxMB) > 0)) {
      setError("Nhập dung lượng lớn hơn 0.");
      return;
    }
    setDialog({ kind: "export", split: mode === "ranges" ? { mode, ranges } : { mode, maxMB: Number(maxMB) } });
  };
  return (
    <Modal title="Tách file" onClose={close} actions={<><button onClick={close}>Hủy</button><button className="primary" onClick={next}>Tiếp tục…</button></>}>
      <label className="row"><input type="radio" checked={mode === "ranges"} onChange={() => setMode("ranges")} /> Theo khoảng trang</label>
      {mode === "ranges" && (
        <label className="field">
          Khoảng trang (1–{n}), mỗi khoảng thành một file. Trang không nằm trong khoảng nào sẽ không được xuất.
          <input value={ranges} onChange={(e) => { setRanges(e.target.value); setError(null); }} />
        </label>
      )}
      <label className="row" style={{ marginTop: 8 }}><input type="radio" checked={mode === "size"} onChange={() => setMode("size")} /> Theo dung lượng tối đa mỗi phần</label>
      {mode === "size" && (
        <label className="field">
          Tối đa mỗi phần (MB)
          <input type="number" min={0.1} step={0.1} value={maxMB} style={{ width: 120 }} onChange={(e) => { setMaxMB(e.target.value); setError(null); }} />
        </label>
      )}
      {error && <div className="error-text">{error}</div>}
    </Modal>
  );
}
