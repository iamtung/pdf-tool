import { ChevronDown, ChevronRight, Mail, Scale, Smartphone, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useEstimate, useProfileEstimate } from "../api/hooks";
import type { Advanced, FileCompression, Preset } from "../api/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  buildFileCompression, cardCompression, effectivePreset, isManual, subsetPlan, validateCompression,
} from "../lib/dialogs";
import { estimatePlan } from "../lib/estimate";
import { chooseEstimate } from "../lib/estimates";
import { PRESET_LABEL, formatBytes } from "../lib/format";
import { profileState } from "../lib/profileStatus";
import { cn } from "../lib/utils";
import { useApp, type ExportContext } from "../state/app";
import { countOverrides, withFileCompression } from "../state/plan";
import Modal from "./Modal";

const PRESETS: Preset[] = ["email", "zalo", "balanced", "high"];
const PRESET_ICON = { email: Mail, zalo: Smartphone, balanced: Scale, high: Sparkles } as const;

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

  // Instant estimates from the precomputed profile; the server is only a fallback.
  const firstPdf = scope.pages.find((p) => p.source.type === "pdf");
  const estDocId = firstPdf && firstPdf.source.type === "pdf" ? firstPdf.source.docId : null;
  const { report: estReport, profile: estProfile, error: estError } = useProfileEstimate(estDocId);
  const reports = estDocId && estReport ? { [estDocId]: estReport } : {};
  const profiles = estDocId && estProfile ? { [estDocId]: estProfile } : {};
  const status = profileState(estProfile, estError);
  const ready = status === "ready";
  const estimateFor = (compression: FileCompression | null) =>
    ready && compression && scope.pages.length
      ? estimatePlan({ plan: scope, reports, profiles, fileCompression: compression })
      : null;
  const instant = estimateFor(fc);
  const preview = fc && scope.pages.length ? withFileCompression(scope, fc) : null;
  const server = useEstimate(preview, null, null, !!preview && instant?.kind !== "ok");
  const chosen = chooseEstimate(instant, server.result);
  const est = { result: chosen.result, loading: !chosen.result && server.loading, error: server.error };
  const targetRung = instant?.kind === "ok" && instant.level ? instant.level : null;

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
      {current && <Button variant="ghost" onClick={() => { dispatch({ type: "clearFileCompression" }); close(); }}>Bỏ nén toàn file</Button>}
      <div className="flex-1" />
      <Button variant="outline" onClick={close}>Hủy</Button>
      <Button variant="outline" disabled={invalid} onClick={() => apply(false)}>Áp dụng</Button>
      <Button disabled={invalid} onClick={() => apply(true)}>Nén và xuất…</Button>
    </>}>
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => {
          const Icon = PRESET_ICON[p];
          const outcome = estimateFor(cardCompression(p, adv));
          const size = status === "computing"
            ? "Đang chuẩn bị ước tính…"
            : status === "error"
              ? "Không ước tính trước được"
              : outcome?.kind === "ok" ? `~${formatBytes(outcome.estimatedBytes)}` : "—";
          return (
            <Button key={p} type="button" variant="outline"
              className={cn(
                "h-auto flex-col items-start gap-1 px-3 py-2 text-left whitespace-normal",
                shownPreset === p && "border-primary bg-accent text-accent-foreground",
              )}
              onClick={() => { setPreset(p); setTarget(""); }}>
              <Icon className="size-4" />
              <span>{PRESET_LABEL[p]}</span>
              <span className="text-xs font-normal text-muted-foreground" data-testid={`preset-estimate-${p}`}>{size}</span>
            </Button>
          );
        })}
      </div>
      <div className="mt-3 space-y-1">
        <Label htmlFor="target-mb">Hoặc nén về dưới (MB)</Label>
        <Input id="target-mb" type="number" min={0.1} step={0.1} value={target} placeholder="ví dụ 10"
          disabled={manual} onChange={(e) => setTarget(e.target.value)} className="w-40"
          aria-invalid={!!errors.target} />
        {manual && <div className="text-xs text-muted-foreground">Đã đặt DPI/JPEG thủ công nên chế độ này tắt.</div>}
        {targetRung && (
          <div className="text-xs text-muted-foreground">
            Bậc: {targetRung.maxDpi} DPI · JPEG {targetRung.quality} · ~{formatBytes(est.result?.estimatedBytes ?? 0)}
          </div>
        )}
      </div>
      {errors.target && <div className="text-xs text-destructive">{errors.target}</div>}

      <Button type="button" variant="ghost" size="sm" className="mt-2 px-1.5" onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? <ChevronDown /> : <ChevronRight />} Tùy chỉnh nâng cao
      </Button>
      {showAdvanced && (
        <div className="mt-1.5 space-y-2">
          <div className="flex gap-3">
            <div className="space-y-1">
              <Label htmlFor="adv-dpi">DPI tối đa</Label>
              <Input id="adv-dpi" type="number" min={36} max={1200} step={1} value={adv.maxDpi ?? ""}
                aria-invalid={!!errors.maxDpi} onChange={(e) => setNum("maxDpi", e.target.value)} className="w-28" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adv-jpeg">Chất lượng JPEG</Label>
              <Input id="adv-jpeg" type="number" min={10} max={100} step={1} value={adv.jpegQuality ?? ""}
                aria-invalid={!!errors.jpegQuality} onChange={(e) => setNum("jpegQuality", e.target.value)} className="w-28" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="adv-gray" checked={!!adv.grayscaleScans}
              onCheckedChange={(v) => setAdv({ ...adv, grayscaleScans: v === true })} />
            <Label htmlFor="adv-gray" className="font-normal">Chuyển ảnh xám cho trang scan gần như không màu</Label>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="adv-meta" checked={!!adv.stripMetadata}
              onCheckedChange={(v) => setAdv({ ...adv, stripMetadata: v === true })} />
            <Label htmlFor="adv-meta" className="font-normal">Bỏ metadata</Label>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="adv-gs" disabled={!health?.ghostscript} checked={!!adv.useGhostscript}
              onCheckedChange={(v) => setAdv({ ...adv, useGhostscript: v === true })} />
            <Label htmlFor="adv-gs" className="font-normal">Dùng Ghostscript (nén mạnh nhất, có thể đổi font/màu)</Label>
          </div>
          {!health?.ghostscript && <div className="text-xs text-muted-foreground">Chưa cài Ghostscript: <code>brew install ghostscript</code></div>}
        </div>
      )}

      {errors.maxDpi && <div className="text-xs text-destructive">{errors.maxDpi}</div>}
      {errors.jpegQuality && <div className="text-xs text-destructive">{errors.jpegQuality}</div>}

      <div className="mt-3.5 flex items-center justify-between gap-3 text-[13px]">
        <span className="text-muted-foreground">Ước tính</span>
        <span className="font-semibold" data-testid="file-estimate">
          {est.result ? `${formatBytes(est.result.originalBytes)} → ~${formatBytes(est.result.estimatedBytes)}` : est.loading ? "Đang tính…" : "—"}
        </span>
      </div>
      {est.result?.targetMet === false && (
        <Alert className="mt-2 border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <AlertDescription className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            Có thể không đạt mục tiêu. Nếu vẫn lớn hơn, công cụ sẽ gợi ý tách thành nhiều phần.
          </AlertDescription>
        </Alert>
      )}
      {est.error && <div className="text-xs text-destructive">{est.error}</div>}
      {overrides > 0 && (
        <Alert className="mt-2 border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          data-testid="override-warning">
          <AlertDescription className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            {overrides} trang đang có mức nén riêng sẽ được thay bằng mức chung.
          </AlertDescription>
        </Alert>
      )}
    </Modal>
  );
}
