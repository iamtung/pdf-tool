import type { DocInfo, FileCompression, Level, Plan, PlanPage } from "../api/types";

export const HISTORY_LIMIT = 100;

export interface EditorState {
  plan: Plan;
  past: Plan[];
  future: Plan[];
  dirty: boolean;
}

export type NewPage = Omit<PlanPage, "id">;

export type Action =
  | { type: "load"; doc: DocInfo }
  | { type: "delete"; ids: string[] }
  | { type: "rotate"; ids: string[]; delta: number }
  | { type: "move"; ids: string[]; toIndex: number }
  | { type: "insert"; pages: NewPage[]; at: number }
  | { type: "setCompress"; ids: string[]; level: Level | null }
  | { type: "applyFileCompression"; fc: FileCompression }
  | { type: "clearFileCompression" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "markSaved" };

let counter = 0;
export const newId = () => `pg${Date.now().toString(36)}${(counter++).toString(36)}`;

export const emptyPlan: Plan = { pages: [], fileCompression: null };
export const initialState: EditorState = { plan: emptyPlan, past: [], future: [], dirty: false };

export function planFromDoc(doc: DocInfo): Plan {
  return {
    pages: Array.from({ length: doc.pageCount }, (_, index) => ({
      id: newId(),
      source: { type: "pdf" as const, docId: doc.docId, index },
      rotate: 0,
      compress: null,
    })),
    fileCompression: null,
  };
}

/** Number of pages carrying their own compression level. */
export function countOverrides(plan: Plan): number {
  return plan.pages.filter((p) => p.compress !== null).length;
}

/** Spec §4.5 rule 1: file compression replaces every per-page level set before it. */
export function withFileCompression(plan: Plan, fc: FileCompression): Plan {
  return { pages: plan.pages.map((p) => ({ ...p, compress: null })), fileCompression: fc };
}

function edit(plan: Plan, action: Action): Plan | null {
  switch (action.type) {
    case "delete": {
      const ids = new Set(action.ids);
      return { ...plan, pages: plan.pages.filter((p) => !ids.has(p.id)) };
    }
    case "rotate": {
      const ids = new Set(action.ids);
      return {
        ...plan,
        pages: plan.pages.map((p) =>
          ids.has(p.id) ? { ...p, rotate: (((p.rotate + action.delta) % 360) + 360) % 360 } : p,
        ),
      };
    }
    case "move": {
      const ids = new Set(action.ids);
      const moving = plan.pages.filter((p) => ids.has(p.id));
      const before = plan.pages.slice(0, action.toIndex).filter((p) => !ids.has(p.id));
      const after = plan.pages.slice(action.toIndex).filter((p) => !ids.has(p.id));
      const pages = [...before, ...moving, ...after];
      return pages.every((p, i) => p === plan.pages[i]) ? null : { ...plan, pages };
    }
    case "insert": {
      const at = Math.max(0, Math.min(action.at, plan.pages.length));
      const added = action.pages.map((p) => ({ ...p, id: newId() }));
      return { ...plan, pages: [...plan.pages.slice(0, at), ...added, ...plan.pages.slice(at)] };
    }
    case "setCompress": {
      const ids = new Set(action.ids);
      return {
        ...plan,
        pages: plan.pages.map((p) => (ids.has(p.id) ? { ...p, compress: action.level } : p)),
      };
    }
    case "applyFileCompression":
      return withFileCompression(plan, action.fc);
    case "clearFileCompression":
      return plan.fileCompression ? { ...plan, fileCompression: null } : null;
    default:
      return null;
  }
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "load":
      return { plan: planFromDoc(action.doc), past: [], future: [], dirty: false };
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { plan: prev, past: state.past.slice(0, -1), future: [state.plan, ...state.future], dirty: true };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { plan: next, past: [...state.past, state.plan], future: rest, dirty: true };
    }
    case "markSaved":
      return { ...state, dirty: false };
    default: {
      const plan = edit(state.plan, action);
      if (!plan) return state;
      const past = [...state.past, state.plan].slice(-HISTORY_LIMIT);
      return { plan, past, future: [], dirty: true };
    }
  }
}

/** Drop ids not in `alive`; returns the same Set when nothing changed (safe in setState). */
export function pruneSet(s: Set<string>, alive: Set<string>): Set<string> {
  for (const id of s) if (!alive.has(id)) return new Set([...s].filter((x) => alive.has(x)));
  return s;
}

/** Drop keys not in `alive`; returns the same object when nothing changed. */
export function pruneRecord<T>(r: Record<string, T>, alive: Set<string>): Record<string, T> {
  const keys = Object.keys(r);
  if (keys.every((k) => alive.has(k))) return r;
  return Object.fromEntries(keys.filter((k) => alive.has(k)).map((k) => [k, r[k]]));
}
