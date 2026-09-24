import { api } from "../api/client";
import type { Plan, SplitOption } from "../api/types";
import { useApp } from "./app";

/**
 * Start an export job and show the result dialog. `onlyIds`/`split` are forwarded to the result
 * dialog so it knows whether the whole document was written (markSaved) and can offer follow-ups.
 * Resolves true when the job was started.
 */
export function useStartExport() {
  const { setDialog, showError } = useApp();
  return async (
    plan: Plan,
    opts: { destDir?: string | null; split?: SplitOption | null; onlyIds?: string[] } = {},
  ): Promise<boolean> => {
    const { onlyIds, ...req } = opts;
    try {
      const { jobId } = await api.exportPlan(plan, req);
      setDialog({ kind: "result", jobId, plan, onlyIds, split: opts.split ?? null });
      return true;
    } catch (e) {
      showError(e);
      return false;
    }
  };
}

/** Open the native file picker and load the chosen PDF as the primary document. */
export function usePickAndOpen() {
  const { openPath, showError } = useApp();
  return async () => {
    try {
      const { paths } = await api.pickFiles("pdf");
      if (paths[0]) await openPath(paths[0], true);
    } catch (e) {
      showError(e);
    }
  };
}

/** Upload a dropped File (no real path available in browsers) then open it. */
export function useOpenDropped() {
  const { openPath, showError } = useApp();
  return async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      showError(new Error("Chỉ hỗ trợ file PDF."));
      return;
    }
    try {
      await openPath(await api.upload(file), true);
    } catch (e) {
      showError(e);
    }
  };
}
