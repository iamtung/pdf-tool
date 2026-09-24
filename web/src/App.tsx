import { useEffect, useState } from "react";
import { api } from "./api/client";
import { Button } from "@/components/ui/button";
import DocumentViewer from "./components/DocumentViewer";
import PagePanel from "./components/PagePanel";
import ThumbnailStrip from "./components/ThumbnailStrip";
import TopBar from "./components/TopBar";
import Dialogs from "./dialogs/Dialogs";
import { cn } from "./lib/utils";
import { confirmDiscard, usePickAndOpen, useOpenDropped } from "./state/actions";
import { useApp } from "./state/app";
import { useCurrentPage, useTargetIds } from "./state/selectors";

export default function App() {
  const { editor, dispatch, setHealth, primary, setCurrentId, setSelected, dialog, prompt, openPath } = useApp();
  const { index } = useCurrentPage();
  const targets = useTargetIds();
  const pickAndOpen = usePickAndOpen();
  const openDropped = useOpenDropped();
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    api.health().then(setHealth).catch(() => undefined);
  }, [setHealth]);

  // `pdftool file.pdf` opens the browser at /?open=<path>
  useEffect(() => {
    const path = new URLSearchParams(window.location.search).get("open");
    if (path) {
      window.history.replaceState(null, "", "/");
      if (!primary || confirmDiscard(editor.dirty)) openPath(path, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editor.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editor.dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Every dialog is state-driven, so a non-"none" dialog (or password prompt) suppresses shortcuts.
      if (dialog.kind !== "none" || prompt) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, select, textarea, [contenteditable]")) return;
      const pages = editor.plan.pages;
      const mod = e.metaKey || e.ctrlKey;
      const goTo = (i: number) => {
        const id = pages[i].id;
        setCurrentId(id);
        setSelected(new Set([id]));
      };
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod || e.altKey) {
        return;
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        if (index >= 0 && index < pages.length - 1) goTo(index + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        if (index > 0) goTo(index - 1);
      } else if ((e.key === "Delete" || e.key === "Backspace") && targets.length) {
        e.preventDefault();
        const next =
          pages.find((p, i) => i > index && !targets.includes(p.id)) ?? pages.find((p) => !targets.includes(p.id));
        dispatch({ type: "delete", ids: targets });
        setCurrentId(next?.id ?? null);
        setSelected(next ? new Set([next.id]) : new Set());
      } else if (e.key === "Escape") {
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog.kind, prompt, editor.plan.pages, index, targets, dispatch, setCurrentId, setSelected]);

  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) openDropped(file);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };

  return (
    <div className="grid h-screen grid-rows-[auto_1fr]" onDragOver={onDragOver} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      <TopBar />
      {primary ? (
        <div className="grid min-h-0 grid-cols-[150px_minmax(0,1fr)_300px]">
          <ThumbnailStrip />
          <DocumentViewer />
          <PagePanel />
        </div>
      ) : (
        <div className={cn(
          "m-6 flex flex-col items-center justify-center gap-3.5 rounded-2xl border-2 border-dashed text-muted-foreground",
          dragOver && "border-primary bg-accent text-accent-foreground",
        )}>
          <div className="text-lg">Kéo thả file PDF vào đây</div>
          <div className="text-muted-foreground">hoặc</div>
          <Button onClick={pickAndOpen}>Mở file…</Button>
          <div className="max-w-md text-center text-xs text-muted-foreground">
            Mở bằng nút "Mở file…" sẽ đọc file tại chỗ, không copy. Mọi xử lý đều diễn ra trên máy này.
          </div>
        </div>
      )}
      <Dialogs />
    </div>
  );
}
