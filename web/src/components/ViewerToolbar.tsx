import { ChevronDown, ChevronUp, FileOutput, RotateCcw, RotateCw, Scissors, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import IconButton from "./IconButton";

export default function ViewerToolbar({
  index, count, targetCount, zoomLabel, onGoTo, onStep, onFit, onDelete, onRotate, onExtract, onSplit,
}: {
  index: number;
  count: number;
  targetCount: number;
  zoomLabel: string;
  onGoTo: (i: number) => void;
  onStep: (dir: 1 | -1) => void;
  onFit: () => void;
  onDelete: () => void;
  onRotate: (delta: number) => void;
  onExtract: () => void;
  onSplit: () => void;
}) {
  const [value, setValue] = useState(String(index + 1));
  useEffect(() => setValue(String(index + 1)), [index]);
  const commit = () => {
    const n = Math.max(1, Math.min(count, Math.floor(Number(value)) || 1));
    setValue(String(n));
    if (n - 1 !== index) onGoTo(n - 1);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-card px-3 py-2">
      <Button variant="ghost" onClick={onDelete}><Trash2 /> Xóa</Button>
      <IconButton label="Xoay trái" icon={RotateCcw} onClick={() => onRotate(-90)} />
      <IconButton label="Xoay phải" icon={RotateCw} onClick={() => onRotate(90)} />
      <Button variant="ghost" onClick={onExtract}><FileOutput /> Trích</Button>
      <Button variant="ghost" onClick={onSplit}><Scissors /> Tách</Button>
      <span className="text-xs text-muted-foreground">{targetCount > 1 ? `${targetCount} trang đang chọn` : ""}</span>
      <div className="flex-1" />
      <IconButton label="Trang trước" icon={ChevronUp} disabled={index <= 0} onClick={() => onGoTo(index - 1)} />
      <span className="text-xs">Trang</span>
      <Input aria-label="Số trang" className="h-7 w-14 text-center" value={value}
        onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} onBlur={commit} />
      <span className="text-xs">/ {count}</span>
      <IconButton label="Trang sau" icon={ChevronDown} disabled={index >= count - 1} onClick={() => onGoTo(index + 1)} />
      <IconButton label="Thu nhỏ" icon={ZoomOut} onClick={() => onStep(-1)} />
      <Button variant="ghost" size="sm" onClick={onFit} title="Vừa khung">{zoomLabel}</Button>
      <IconButton label="Phóng to" icon={ZoomIn} onClick={() => onStep(1)} />
    </div>
  );
}
