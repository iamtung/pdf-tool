import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { ApiError, api } from "../api/client";
import type { DocInfo, Health, Plan, SplitOption } from "../api/types";
import { initialState, pruneRecord, pruneSet, reducer, type Action, type EditorState } from "./plan";

/** What an export writes: every page, or only `onlyIds`; optionally split into several files. */
export interface ExportContext {
  onlyIds?: string[];
  split?: SplitOption | null;
}

export type DialogState =
  | { kind: "none" }
  | ({ kind: "compress" } & ExportContext)
  | { kind: "insert"; at: number }
  | { kind: "split"; ranges?: string; maxMB?: number; onlyIds?: string[] }
  | ({ kind: "export" } & ExportContext)
  | ({ kind: "result"; jobId: string; plan: Plan } & ExportContext)
  | { kind: "changed"; path: string }
  | { kind: "error"; message: string };

export interface PasswordPrompt {
  path: string;
  wrong: boolean;
  resolve: (pw: string | null) => void;
}

interface AppContextValue {
  editor: EditorState;
  dispatch: (a: Action) => void;
  docs: Record<string, DocInfo>;
  primary: DocInfo | null;
  health: Health | null;
  setHealth: (h: Health) => void;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  currentId: string | null;
  /** Bumped on every user page selection (even re-selecting the current page); never by scrolling. */
  pageSelection: number;
  setCurrentId: (id: string | null, origin?: "user" | "scroll") => void;
  dialog: DialogState;
  setDialog: (d: DialogState) => void;
  /** Password prompt is a separate layer so it can sit on top of another dialog. */
  prompt: PasswordPrompt | null;
  estimates: Record<string, number>;
  setEstimates: (f: (e: Record<string, number>) => Record<string, number>) => void;
  /**
   * Open a PDF, asking for a password if needed. primary=true resets the editor.
   * Returns null on failure or password cancel; errors go to `onError` if given, else showError.
   */
  openPath: (path: string, primary: boolean, onError?: (e: unknown) => void) => Promise<DocInfo | null>;
  /** Close a secondary doc on the server and drop it from `docs` (it must not be used by the plan). */
  forgetDoc: (docId: string) => void;
  showError: (e: unknown, path?: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [editor, dispatch] = useReducer(reducer, initialState);
  const [docs, setDocs] = useState<Record<string, DocInfo>>({});
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [currentId, setCurrentIdState] = useState<string | null>(null);
  const [pageSelection, setPageSelection] = useState(0);
  const setCurrentId = useCallback((id: string | null, origin: "user" | "scroll" = "user") => {
    if (origin === "user") setPageSelection((n) => n + 1);
    setCurrentIdState(id);
  }, []);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [prompt, setPrompt] = useState<PasswordPrompt | null>(null);
  const [estimates, setEstimates] = useState<Record<string, number>>({});

  // Undo/redo/delete can remove pages: forget selection, current page and estimates for them.
  const planPages = editor.plan.pages;
  useEffect(() => {
    const alive = new Set(planPages.map((p) => p.id));
    setSelected((s) => pruneSet(s, alive));
    setCurrentIdState((c) => (c && !alive.has(c) ? null : c));
    setEstimates((e) => pruneRecord(e, alive));
  }, [planPages]);

  const showError = useCallback((e: unknown, path?: string) => {
    if (e instanceof ApiError && e.code === "file_changed") {
      const doc = primaryId ? docs[primaryId] : null;
      const target = path ?? doc?.path;
      setDialog(target ? { kind: "changed", path: target } : { kind: "error", message: e.message });
      return;
    }
    setDialog({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  }, [docs, primaryId]);

  const openPath = useCallback(async (path: string, primary: boolean, onError?: (e: unknown) => void): Promise<DocInfo | null> => {
    let password: string | undefined;
    let wrong = false;
    for (;;) {
      try {
        const doc = await api.openDoc(path, password);
        if (primary) {
          const oldIds = Object.keys(docsRef.current).filter((id) => id !== doc.docId);
          for (const id of oldIds) api.closeDoc(id).catch(() => {});
          setDocs({ [doc.docId]: doc });
          setPrimaryId(doc.docId);
          dispatch({ type: "load", doc });
          setSelected(new Set());
          setEstimates(() => ({}));
          setCurrentId(null);
          setDialog({ kind: "none" });
        } else {
          setDocs((d) => ({ ...d, [doc.docId]: doc }));
        }
        return doc;
      } catch (e) {
        if (e instanceof ApiError && (e.code === "password_required" || e.code === "wrong_password")) {
          wrong = e.code === "wrong_password";
          // Assumes AppProvider lives for the app's lifetime: the prompt promise's
          // resolve callback is captured here and invoked later from setPrompt's consumer.
          const pw = await new Promise<string | null>((resolve) => setPrompt({ path, wrong, resolve }));
          setPrompt(null);
          if (pw === null) return null;
          password = pw;
          continue;
        }
        if (onError) onError(e);
        else showError(e, path);
        return null;
      }
    }
  }, [showError]);

  const forgetDoc = useCallback((docId: string) => {
    api.closeDoc(docId).catch(() => {});
    setDocs((d) => {
      if (!(docId in d)) return d;
      const next = { ...d };
      delete next[docId];
      return next;
    });
  }, []);

  const value: AppContextValue = {
    editor, dispatch, docs, primary: primaryId ? docs[primaryId] ?? null : null,
    health, setHealth, selected, setSelected, currentId, pageSelection, setCurrentId, dialog, setDialog, prompt,
    estimates, setEstimates, openPath, forgetDoc, showError,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}
