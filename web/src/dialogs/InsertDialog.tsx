import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { DocInfo } from "../api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { neighbourSize } from "../lib/pages";
import { useApp } from "../state/app";
import type { NewPage } from "../state/plan";
import Modal from "./Modal";

type Kind = "pdf" | "image" | "blank";

const KIND_LABEL_VI: Record<Kind, string> = { pdf: "Từ PDF khác", image: "Từ ảnh JPG/PNG", blank: "Trang trắng" };

function ImagePreview({ path }: { path: string }) {
  const q = useQuery({ queryKey: ["render-source", { type: "image", path }, 90], queryFn: () => api.renderSource({ type: "image", path }, 90) });
  return <div className="flex h-[120px] items-center justify-center overflow-hidden rounded-md border bg-white">{q.data && <img src={q.data} alt="" className="max-h-full max-w-full" />}</div>;
}

export default function InsertDialog({ at }: { at: number }) {
  const { editor, dispatch, docs, setDialog, openPath, forgetDoc } = useApp();
  const pages = editor.plan.pages;
  const n = pages.length;
  const [kind, setKind] = useState<Kind>("pdf");
  const [where, setWhere] = useState<"before" | "after">(at < n ? "before" : "after");
  const [pageNo, setPageNo] = useState(at < n ? at + 1 : n);
  const [srcDoc, setSrcDoc] = useState<DocInfo | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [images, setImages] = useState<string[]>([]);
  const [blankCount, setBlankCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const close = () => setDialog({ kind: "none" });

  // The extra PDF is opened on the server as soon as it is picked; if it never gets inserted
  // (cancel, another file picked, dialog replaced) close it again so it doesn't leak.
  const pendingDoc = useRef<string | null>(null);
  const forgetRef = useRef(forgetDoc);
  forgetRef.current = forgetDoc;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pendingDoc.current) forgetRef.current(pendingDoc.current);
      pendingDoc.current = null;
    };
  }, []);

  const index = n === 0 ? 0 : where === "before" ? pageNo - 1 : pageNo;
  const chooseDoc = async () => {
    setError(null);
    try {
      const { paths } = await api.pickFiles("pdf");
      if (!paths[0]) return;
      const doc = await openPath(paths[0], false, (e) => setError(e instanceof Error ? e.message : String(e)));
      if (doc && !mounted.current) {
        forgetDoc(doc.docId); // dialog went away while the file was opening
        return;
      }
      if (doc) {
        if (pendingDoc.current && pendingDoc.current !== doc.docId) forgetDoc(pendingDoc.current);
        pendingDoc.current = doc.docId;
        setSrcDoc(doc);
        setPicked(new Set(Array.from({ length: doc.pageCount }, (_, i) => i)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const chooseImages = async () => {
    try {
      const { paths } = await api.pickFiles("image", true);
      if (paths.length) setImages(paths);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const togglePage = (i: number) => {
    const next = new Set(picked);
    next.has(i) ? next.delete(i) : next.add(i);
    setPicked(next);
  };

  const insert = () => {
    let added: NewPage[] = [];
    if (kind === "pdf" && srcDoc) {
      added = [...picked].sort((a, b) => a - b).map((i) => ({ source: { type: "pdf", docId: srcDoc.docId, index: i }, rotate: 0, compress: null }));
    } else if (kind === "image") {
      added = images.map((path) => ({ source: { type: "image", path }, rotate: 0, compress: null }));
    } else if (kind === "blank") {
      const size = neighbourSize(pages, index, docs, where);
      added = Array.from({ length: blankCount }, () => ({ source: { type: "blank", ...size }, rotate: 0, compress: null }));
    }
    if (!added.length) {
      setError("Chưa chọn trang nào để chèn.");
      return;
    }
    if (n > 0 && (pageNo < 1 || pageNo > n)) {
      setError(`Số trang phải từ 1 đến ${n}.`);
      return;
    }
    if (kind === "pdf") pendingDoc.current = null; // now referenced by the plan: keep it open
    dispatch({ type: "insert", pages: added, at: index });
    setDialog({ kind: "none" });
  };

  return (
    <Modal title="Chèn trang" wide={kind === "pdf" && !!srcDoc} onClose={close}
      actions={<>
        <Button variant="outline" onClick={close}>Hủy</Button>
        <Button onClick={insert}>Chèn</Button>
      </>}>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {(["pdf", "image", "blank"] as Kind[]).map((k) => (
          <Button key={k} type="button" variant="outline"
            className={cn("h-auto py-2 text-xs whitespace-normal", kind === k && "border-primary bg-accent text-accent-foreground")}
            onClick={() => { setKind(k); setError(null); }}>
            {KIND_LABEL_VI[k]}
          </Button>
        ))}
      </div>

      {kind === "pdf" && (
        <>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={chooseDoc}>Chọn file PDF…</Button>
            {srcDoc && <span className="text-xs text-muted-foreground">{srcDoc.name} · {srcDoc.pageCount} trang · đã chọn {picked.size}</span>}
            {srcDoc && (
              <Button variant="link" size="sm" onClick={() => setPicked(new Set(picked.size === srcDoc.pageCount ? [] : Array.from({ length: srcDoc.pageCount }, (_, i) => i)))}>
                {picked.size === srcDoc.pageCount ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </Button>
            )}
          </div>
          {srcDoc && (
            <div className="my-2 grid max-h-80 grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2 overflow-y-auto">
              {Array.from({ length: srcDoc.pageCount }, (_, i) => (
                <div key={i}>
                  <div className={cn("flex h-[120px] cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-white", picked.has(i) && "outline-3 outline-offset-1 outline-primary")}
                    onClick={() => togglePage(i)}>
                    <img src={api.thumbUrl(srcDoc.docId, i, 120)} alt={`Trang ${i + 1}`} loading="lazy" className="max-h-full max-w-full" />
                  </div>
                  <div className="py-1 text-center text-[11px] text-muted-foreground">{i + 1}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {kind === "image" && (
        <>
          <Button variant="outline" onClick={chooseImages}>Chọn ảnh…</Button>
          {images.length > 0 && (
            <div className="my-2 grid max-h-80 grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2 overflow-y-auto">
              {images.map((p) => <ImagePreview key={p} path={p} />)}
            </div>
          )}
          <div className="mt-1.5 text-xs text-muted-foreground">Mỗi ảnh thành một trang, kích thước trang bằng ảnh ở 150 DPI.</div>
        </>
      )}
      {kind === "blank" && (
        <div className="space-y-1">
          <Label htmlFor="blank-count">Số trang trắng</Label>
          <Input id="blank-count" type="number" min={1} max={50} value={blankCount} className="w-24"
            onChange={(e) => setBlankCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          <div className="text-xs text-muted-foreground">Cùng khổ với trang bên cạnh.</div>
        </div>
      )}

      {n > 0 && (
        <div className="mt-3.5 flex items-center gap-2 text-sm">
          <span>Vị trí:</span>
          <Select value={where} onValueChange={(v) => setWhere(v as "before" | "after")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="before">Trước trang</SelectItem>
              <SelectItem value="after">Sau trang</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" min={1} max={n} value={pageNo} className="w-20" onChange={(e) => setPageNo(Number(e.target.value))} />
          <span className="text-xs text-muted-foreground">/ {n}</span>
        </div>
      )}
      {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
    </Modal>
  );
}
