import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useApp } from "../state/app";
import { useCurrentPage, useTargetIds } from "../state/selectors";
import { displaySize } from "../lib/pages";
import {
  PAGE_GAP, initialViewportState, isScrollKey, mostVisiblePage, pageLayouts, pageOffsetFraction,
  scrollTopForOffset, viewportReducer,
} from "../lib/viewport";
import ViewerPage from "./ViewerPage";
import ViewerToolbar from "./ViewerToolbar";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export default function DocumentViewer() {
  const { editor, docs, selected, currentId, setCurrentId, setSelected, dispatch, setDialog } = useApp();
  const { index: currentIndex } = useCurrentPage();
  const targets = useTargetIds();
  const pages = editor.plan.pages;
  const scrollRef = useRef<HTMLDivElement>(null);

  const [width, setWidth] = useState(800);
  const [zoomState, setZoomState] = useState<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const boxes = useMemo(
    () => pages.map((p) => {
      const s = displaySize(p, docs);
      return { width: s.width, height: s.height };
    }),
    [pages, docs],
  );
  const fitZoom = useMemo(() => {
    const widest = boxes.length ? Math.max(...boxes.map((b) => b.width)) : 595;
    return Math.min(1.5, Math.max(0.2, (width - 40) / widest));
  }, [boxes, width]);
  const zoom = zoomState ?? fitZoom;
  const layouts = useMemo(() => pageLayouts(boxes, zoom), [boxes, zoom]);
  const scale = Math.min(8, Math.ceil(zoom * window.devicePixelRatio * 4) / 4); // 0.25 steps, API max 8

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (i) => pages[i]?.id ?? i,
    estimateSize: (i) => (layouts[i]?.height ?? 0) + PAGE_GAP,
    overscan: 2,
  });
  useEffect(() => virtualizer.measure(), [layouts, virtualizer]);

  const [nav, dispatchNav] = useReducer(viewportReducer, initialViewportState);
  const stickyRef = useRef(nav);
  stickyRef.current = nav;
  const lastScrollId = useRef<string | null>(null);
  const currentIdRef = useRef<string | null>(currentId);
  currentIdRef.current = currentId;
  const selectedCountRef = useRef(selected.size);
  selectedCountRef.current = selected.size;
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // A current-page change that did not come from scrolling is a navigation: make it sticky and jump there.
  useEffect(() => {
    const page = pagesRef.current.find((p) => p.id === currentId);
    if (!page || page.id === lastScrollId.current) return;
    const index = pagesRef.current.indexOf(page);
    dispatchNav({ type: "navigate", index });
    const el = scrollRef.current;
    if (el) el.scrollTop = layoutsRef.current[index]?.top ?? 0;
    lastScrollId.current = page.id;
  }, [currentId]);

  // Scroll tracking, throttled to one update per animation frame; ignored while a navigation is sticky.
  const raf = useRef<number | null>(null);
  const onScroll = () => {
    if (raf.current != null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const el = scrollRef.current;
      if (!el || stickyRef.current.sticky !== null) return;
      const index = mostVisiblePage(layoutsRef.current, el.scrollTop, el.clientHeight);
      const id = pagesRef.current[index]?.id;
      if (!id || id === currentIdRef.current) return;
      lastScrollId.current = id;
      currentIdRef.current = id;
      setCurrentId(id);
      if (selectedCountRef.current <= 1) setSelected(new Set([id]));
    });
  };
  useEffect(() => () => { if (raf.current != null) cancelAnimationFrame(raf.current); }, []);

  // User intent (wheel/touch/drag/scroll keys) releases the sticky page so tracking resumes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const release = () => dispatchNav({ type: "user-intent" });
    const onKey = (e: KeyboardEvent) => { if (isScrollKey(e.key)) release(); };
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("touchstart", release, { passive: true });
    el.addEventListener("pointerdown", release);
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", release);
      el.removeEventListener("touchstart", release);
      el.removeEventListener("pointerdown", release);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Zoom keeps the current page and its relative offset in view.
  const pendingScroll = useRef<number | null>(null);
  const changeZoom = (next: number | null) => {
    const el = scrollRef.current;
    if (el && currentIndex >= 0) {
      const fraction = pageOffsetFraction(layouts[currentIndex], el.scrollTop);
      const target = pageLayouts(boxes, next ?? fitZoom)[currentIndex];
      pendingScroll.current = scrollTopForOffset(target, fraction);
    }
    setZoomState(next);
  };
  useEffect(() => {
    if (pendingScroll.current == null) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = pendingScroll.current;
    pendingScroll.current = null;
  }, [zoom]);

  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((v) => v > zoom + 0.01) : [...ZOOMS].reverse().find((v) => v < zoom - 0.01);
    if (next) changeZoom(next);
  };
  const goTo = (i: number) => {
    const page = pages[i];
    if (!page) return;
    setCurrentId(page.id);
    setSelected(new Set([page.id]));
  };
  const remove = () => {
    const next = pages.find((p, i) => i > currentIndex && !targets.includes(p.id)) ?? pages.find((p) => !targets.includes(p.id));
    dispatch({ type: "delete", ids: targets });
    setSelected(new Set());
    setCurrentId(next?.id ?? null);
  };
  const splitHere = () => {
    const n = pages.length;
    const ranges = currentIndex > 0 ? `1-${currentIndex}, ${currentIndex + 1}-${n}` : `1-${n}`;
    setDialog({ kind: "split", ranges });
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      {pages.length > 0 ? (
        <ViewerToolbar
          index={Math.max(0, currentIndex)} count={pages.length} targetCount={targets.length}
          zoomLabel={`${Math.round(zoom * 100)}%`}
          onGoTo={goTo} onStep={step} onFit={() => changeZoom(null)}
          onDelete={remove} onRotate={(delta) => dispatch({ type: "rotate", ids: targets, delta })}
          onExtract={() => setDialog({ kind: "export", onlyIds: targets })} onSplit={splitHere}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-5 text-muted-foreground">Không còn trang nào.</div>
      )}
      <div ref={scrollRef} data-testid="viewer" className="min-h-0 flex-1 overflow-y-auto bg-muted/20" onScroll={onScroll}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const page = pages[item.index];
            const layout = layouts[item.index];
            if (!page || !layout) return null;
            return (
              <div key={item.key} className="absolute right-0 left-0"
                style={{ top: layout.top, height: layout.height }}>
                <ViewerPage page={page} n={item.index + 1} width={layout.width} height={layout.height} scale={scale} zoom={zoom} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
