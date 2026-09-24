import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    <Modal title="Tách file" onClose={close}
      actions={<>
        <Button variant="outline" onClick={close}>Hủy</Button>
        <Button disabled={!!error} onClick={next}>Tiếp tục…</Button>
      </>}>
      <ToggleGroup type="single" value={mode} className="w-full" onValueChange={(v) => { if (v) setMode(v as "ranges" | "size"); }}>
        <ToggleGroupItem value="ranges" className="flex-1">Theo khoảng trang</ToggleGroupItem>
        <ToggleGroupItem value="size" className="flex-1">Theo dung lượng tối đa mỗi phần</ToggleGroupItem>
      </ToggleGroup>
      {mode === "ranges" ? (
        <div className="mt-3 space-y-1">
          <Label htmlFor="split-ranges">Khoảng trang (1–{n}{onlyIds ? ", tính trên các trang đã chọn" : ""})</Label>
          <Input id="split-ranges" value={ranges} aria-invalid={!!error} onChange={(e) => setRanges(e.target.value)} />
          <div className="text-xs text-muted-foreground">Mỗi khoảng thành một file. Trang không nằm trong khoảng nào sẽ không được xuất.</div>
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          <Label htmlFor="split-max">Tối đa mỗi phần (MB)</Label>
          <Input id="split-max" type="number" min={0.1} step={0.1} value={maxMB} className="w-28"
            aria-invalid={!!error} onChange={(e) => setMaxMB(e.target.value)} />
        </div>
      )}
      {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
    </Modal>
  );
}
