import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { SyncDetail } from "@keeper.sh/data-schemas";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { resolveSyncError } from "./sync-errors";
import { draftFallbackName, toCreateBody, type SyncDraft } from "./sync-draft";
import { syncPagePath, type CalendarsById } from "./syncs";
import { createSync, useRefreshSyncs } from "./use-syncs";

export interface CreateSyncFlow {
  create: (draft: SyncDraft, onCreated?: (created: SyncDetail) => void) => Promise<SyncDetail | null>;
  creating: boolean;
  error: string | null;
  clearError: () => void;
}

// Creates a sync from a draft and opens its page; `onCreated` runs first, for the caller's own analytics or cleanup.
export function useCreateSync(calendarsById: CalendarsById, failureMessage = "Failed to create this sync."): CreateSyncFlow {
  const navigate = useNavigate();
  const refresh = useRefreshSyncs();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (draft: SyncDraft, onCreated?: (created: SyncDetail) => void) => {
    setCreating(true);
    setError(null);
    try {
      const created = await createSync(toCreateBody(draft, draftFallbackName(draft, calendarsById)));
      track(ANALYTICS_EVENTS.sync_created, { mode: created.mode, share_as: created.shareAs, template: draft.template ?? "scratch" });
      onCreated?.(created);
      await refresh();
      await navigate({ ignoreBlocker: true, to: syncPagePath(created.id) });
      return created;
    } catch (createFailure) {
      setError(resolveSyncError(createFailure, failureMessage, calendarsById));
      setCreating(false);
      return null;
    }
  }, [calendarsById, failureMessage, navigate, refresh]);

  const clearError = useCallback(() => setError(null), []);

  return { clearError, create, creating, error };
}

// Fires once each time a draft runs into another sync's calendar link, since the disabled button can't report it.
export function useTrackConflicts(hasConflicts: boolean): void {
  const shown = useRef(false);
  useEffect(() => {
    if (hasConflicts && !shown.current) track(ANALYTICS_EVENTS.sync_conflict_shown);
    shown.current = hasConflicts;
  }, [hasConflicts]);
}
