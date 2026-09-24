import { createContext, useCallback, useContext, useReducer, useRef, useState, type ReactNode } from "react";
import { ApiError, api } from "../api/client";
import type { DocInfo, Health } from "../api/types";
import { initialState, reducer, type Action, type EditorState } from "./plan";

export type DialogState =
  | { kind: "none" }
  | { kind: "compress" }
  | { kind: "insert"; at: number }
  | { kind: "split"; ranges?: string; maxMB?: number }
  | { kind: "export"; split?: import("../api/types").SplitOption | null; onlyIds?: string[] }
  | { kind: "result"; jobId: string; plan: import("../api/types").Plan }
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
  setCurrentId: (id: string | null) => void;
  dialog: DialogState;
  setDialog: (d: DialogState) => void;
  /** Password prompt is a separate layer so it can sit on top of another dialog. */
  prompt: PasswordPrompt | null;
  estimates: Record<string, number>;
  setEstimates: (f: (e: Record<string, number>) => Record<string, number>) => void;
  /** Open a PDF, asking for a password if needed. primary=true resets the editor. */
  openPath: (path: string, primary: boolean) => Promise<DocInfo | null>;
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
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [prompt, setPrompt] = useState<PasswordPrompt | null>(null);
  const [estimates, setEstimates] = useState<Record<string, number>>({});

  const showError = useCallback((e: unknown, path?: string) => {
    if (e instanceof ApiError && e.code === "file_changed") {
      const doc = primaryId ? docs[primaryId] : null;
      const target = path ?? doc?.path;
      setDialog(target ? { kind: "changed", path: target } : { kind: "error", message: e.message });
      return;
    }
    setDialog({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  }, [docs, primaryId]);

  const openPath = useCallback(async (path: string, primary: boolean): Promise<DocInfo | null> => {
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
        showError(e, path);
        return null;
      }
    }
  }, [showError]);

  const value: AppContextValue = {
    editor, dispatch, docs, primary: primaryId ? docs[primaryId] ?? null : null,
    health, setHealth, selected, setSelected, currentId, setCurrentId, dialog, setDialog, prompt,
    estimates, setEstimates, openPath, showError,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}
