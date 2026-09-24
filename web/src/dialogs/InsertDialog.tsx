import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { DocInfo } from "../api/types";
import { neighbourSize } from "../lib/pages";
import { useApp } from "../state/app";
import type { NewPage } from "../state/plan";
import Modal from "./Modal";

type Kind = "pdf" | "image" | "blank";

function ImagePreview({ path }: { path: string }) {
  const q = useQuery({ queryKey: ["render-source", { type: "image", path }, 90], queryFn: () => api.renderSource({ type: "image", path }, 90) });
  return <div className="thumb" style={{ height: 120 }}>{q.data && <img src={q.data} alt="" />}</div>;
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
      actions={<><button onClick={close}>Hủy</button><button className="primary" onClick={insert}>Chèn</button></>}>
      <div className="chips" style={{ marginBottom: 12 }}>
        {(["pdf", "image", "blank"] as Kind[]).map((k) => (
          <button key={k} className={`chip${kind === k ? " on" : ""}`} onClick={() => { setKind(k); setError(null); }}>
            {k === "pdf" ? "Từ PDF khác" : k === "image" ? "Từ ảnh JPG/PNG" : "Trang trắng"}
          </button>
        ))}
      </div>

      {kind === "pdf" && (
        <>
          <div className="row">
            <button onClick={chooseDoc}>Chọn file PDF…</button>
            {srcDoc && <span className="small muted">{srcDoc.name} · {srcDoc.pageCount} trang · đã chọn {picked.size}</span>}
            {srcDoc && <button className="link small" onClick={() => setPicked(new Set(picked.size === srcDoc.pageCount ? [] : Array.from({ length: srcDoc.pageCount }, (_, i) => i)))}>
              {picked.size === srcDoc.pageCount ? "Bỏ chọn tất cả" : "Chọn tất cả"}
            </button>}
          </div>
          {srcDoc && (
            <div className="grid-pick">
              {Array.from({ length: srcDoc.pageCount }, (_, i) => (
                <div key={i}>
                  <div className={`thumb${picked.has(i) ? " selected" : ""}`} onClick={() => togglePage(i)}>
                    <img src={api.thumbUrl(srcDoc.docId, i, 120)} alt={`Trang ${i + 1}`} loading="lazy" />
                  </div>
                  <div className="thumb-label">{i + 1}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {kind === "image" && (
        <>
          <button onClick={chooseImages}>Chọn ảnh…</button>
          {images.length > 0 && (
            <div className="grid-pick">{images.map((p) => <ImagePreview key={p} path={p} />)}</div>
          )}
          <div className="small muted" style={{ marginTop: 6 }}>Mỗi ảnh thành một trang, kích thước trang bằng ảnh ở 150 DPI.</div>
        </>
      )}
      {kind === "blank" && (
        <label className="field">
          Số trang trắng
          <input type="number" min={1} max={50} value={blankCount} style={{ width: 100 }} onChange={(e) => setBlankCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          <span className="small muted">Cùng khổ với trang bên cạnh.</span>
        </label>
      )}

      {n > 0 && (
        <div className="row" style={{ marginTop: 14 }}>
          <span>Vị trí:</span>
          <select value={where} onChange={(e) => setWhere(e.target.value as "before" | "after")}>
            <option value="before">Trước trang</option>
            <option value="after">Sau trang</option>
          </select>
          <input type="number" min={1} max={n} value={pageNo} style={{ width: 80 }} onChange={(e) => setPageNo(Number(e.target.value))} />
          <span className="small muted">/ {n}</span>
        </div>
      )}
      {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
