import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAnalysis, useEstimate, usePlanEstimateInputs } from "../api/hooks";
import type { Level, Plan } from "../api/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { estimatePlan, type EstimateOutcome } from "../lib/estimate";
import { chooseEstimate } from "../lib/estimates";
import { KIND_LABEL, LEVEL_LABEL, formatBytes, paperName } from "../lib/format";
import { displaySize } from "../lib/pages";
import { tabAfterSelection, type PanelTab } from "../lib/panel";
import { useApp } from "../state/app";
import { useCurrentPage, usePageDetail, useTargetIds } from "../state/selectors";
import FileOverview from "./FileOverview";
import Kv from "./Kv";

const LEVELS: Level[] = ["light", "medium", "strong"];

export default function PagePanel() {
  const { pageSelection } = useApp();
  const [tab, setTab] = useState<PanelTab>("page");
  const previousSelection = useRef(pageSelection);
  useEffect(() => {
    // Compute eagerly: a lazy setState updater would see the ref already advanced below.
    const next = tabAfterSelection(previousSelection.current, pageSelection, tab);
    previousSelection.current = pageSelection;
    if (next !== tab) setTab(next);
  }, [pageSelection, tab]);

  return (
    <aside className="flex min-h-0 flex-col border-l bg-card">
      <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)} className="min-h-0 flex-1">
        <TabsList className="mx-2 mt-2">
          <TabsTrigger value="page">Trang</TabsTrigger>
          <TabsTrigger value="overview">Tổng quan</TabsTrigger>
        </TabsList>
        <TabsContent value="page" className="min-h-0 overflow-y-auto px-3 pb-3">
          <PageInfo />
        </TabsContent>
        <TabsContent value="overview" className="min-h-0 overflow-y-auto px-3 pb-3">
          <FileOverview />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function PageInfo() {
  const { editor, dispatch, docs, setEstimates } = useApp();
  const { page, index } = useCurrentPage();
  const targets = useTargetIds();
  const detail = usePageDetail(page);
  const { report } = useAnalysis(page?.source.type === "pdf" ? page.source.docId : null);
  const [level, setLevel] = useState<Level>(page?.compress ?? "medium");
  useEffect(() => setLevel(page?.compress ?? "medium"), [page?.id, page?.compress]);
  const targetPages = editor.plan.pages.filter((p) => targets.includes(p.id));
  const allBlank = targetPages.length > 0 && targetPages.every((p) => p.source.type === "blank");
  // Only what affects the estimate goes into the key: the target pages, without their current
  // level (Áp dụng changes it) and without file compression (the page level overrides it).
  const estPlan: Plan = { pages: targetPages.map((p) => ({ ...p, compress: null })), fileCompression: null };
  const { reports, profiles } = usePlanEstimateInputs(editor.plan);
  const instant = useMemo<EstimateOutcome | null>(() => {
    if (allBlank || !targets.length) return null;
    return estimatePlan({ plan: editor.plan, reports, profiles, pageIds: targets, level });
  }, [reports, profiles, allBlank, targets, editor.plan, level]);
  const server = useEstimate(estPlan, targets, level, targets.length > 0 && !allBlank && instant?.kind !== "ok");
  const chosen = chooseEstimate(instant, server.result);
  const est = { result: chosen.result, loading: !chosen.result && server.loading, error: server.error };
  if (!page) return null;

  const size = displaySize(page, docs);
  const anyOverride = targetPages.some((p) => p.compress);
  const dropEstimates = () => setEstimates((e) => {
    const next = { ...e };
    for (const id of targets) delete next[id];
    return next;
  });
  const apply = () => {
    dispatch({ type: "setCompress", ids: targets, level });
    if (est.result) {
      const share = est.result.estimatedBytes / targets.length;
      setEstimates((e) => ({ ...e, ...Object.fromEntries(targets.map((id) => [id, share])) }));
    } else {
      dropEstimates(); // an old estimate would belong to a different level
    }
  };
  const clearLevel = () => {
    dispatch({ type: "setCompress", ids: targets, level: null });
    dropEstimates();
  };

  return (
    <div className="space-y-3 pt-1">
      <section>
        <h3 className="mb-1.5 text-sm font-semibold">
          Trang {index + 1}{targets.length > 1 ? ` (+${targets.length - 1} trang chọn)` : ""}
        </h3>
        {detail ? (
          <>
            <Kv label="Dung lượng">
              <span className={detail.heavy ? "font-semibold text-amber-600 dark:text-amber-400" : "font-semibold"}>
                {formatBytes(detail.size)}
              </span>
            </Kv>
            <Kv label="Loại trang">{KIND_LABEL[detail.kind]}</Kv>
            <Kv label="Khổ giấy">{paperName(size.width, size.height)}</Kv>
            <Kv label="Số ảnh">{detail.imageCount}</Kv>
            <Kv label="DPI cao nhất">{detail.maxDpi || "—"}</Kv>
            <Kv label="Font">{detail.fontCount}</Kv>
            {detail.images.map((x) => {
              const im = report?.images[String(x)];
              return im ? (
                <div key={x} className="mt-1 text-xs text-muted-foreground">
                  Ảnh {im.width}×{im.height} · {im.dpi} DPI · {im.filter ?? "?"} · {formatBytes(im.size)}
                  {im.pages.length > 1 ? ` · dùng ở ${im.pages.length} trang` : ""}
                </div>
              ) : null;
            })}
          </>
        ) : (
          <div className="text-xs text-muted-foreground">
            {page.source.type === "pdf" ? "Đang phân tích…" : page.source.type === "blank" ? "Trang trắng" : "Trang từ ảnh"}
          </div>
        )}
      </section>
      {allBlank ? (
        <section className="border-t pt-3">
          <h3 className="mb-1.5 text-sm font-semibold">Nén</h3>
          <div className="text-xs text-muted-foreground">Trang trắng — không có gì để nén.</div>
        </section>
      ) : (
        <section className="border-t pt-3">
          <h3 className="mb-2 text-sm font-semibold">Nén {targets.length > 1 ? `${targets.length} trang` : "trang này"}</h3>
          <ToggleGroup type="single" value={level} spacing={2} className="w-full"
            onValueChange={(v) => { if (v) setLevel(v as Level); }}>
            {LEVELS.map((lv) => (
              <ToggleGroupItem key={lv} value={lv} className="flex-1">{LEVEL_LABEL[lv]}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Kv label="Ước tính" className="mt-2.5">
            <span className="font-semibold" data-testid="page-estimate">
              {est.result
                ? `${formatBytes(est.result.originalBytes)} → ~${formatBytes(est.result.estimatedBytes)}`
                : est.loading ? "Đang tính…" : "—"}
            </span>
          </Kv>
          {est.error && <div className="text-xs text-destructive">{est.error}</div>}
          {editor.plan.fileCompression && (
            <div className="my-1.5 text-xs text-muted-foreground">
              Mức riêng sẽ dùng thay cho mức nén toàn file ở các trang này.
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <Button className="flex-1" onClick={apply}><Check /> Áp dụng</Button>
            {anyOverride && <Button variant="outline" onClick={clearLevel}>Bỏ mức riêng</Button>}
          </div>
        </section>
      )}
    </div>
  );
}
