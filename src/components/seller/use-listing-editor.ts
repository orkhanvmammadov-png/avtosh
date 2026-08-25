"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicApiError } from "@/lib/marketplace/public-api";
import {
  fetchOwnerListing,
  patchListing,
  type OwnerListingDto,
  type PatchBody,
} from "@/lib/seller/owner-api";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 800;

/**
 * Serialized editor state machine for one owner listing.
 *
 * Every mutation — debounced field patches, image operations, submit —
 * flows through ONE promise chain, so this browser tab can never race
 * itself into a revision conflict. `expected_revision` is always read
 * from the freshest DTO at send time, and every server response
 * replaces the DTO wholesale (bringing server-side dependent-field
 * clearing along with it).
 *
 * A real LISTING_REVISION_CONFLICT (another tab/window) freezes all
 * saving until the seller explicitly reloads the server version —
 * local changes are never silently pushed over newer state.
 */
export function useListingEditor(initial: OwnerListingDto) {
  const [dto, setDto] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  // refs are written only inside event/callback code (adoptDto,
  // handleMutationError, reloadFromServer) — never during render
  const dtoRef = useRef(initial);
  const conflictRef = useRef(false);
  const pendingRef = useRef<PatchBody>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const flushResolversRef = useRef<((ok: boolean) => void)[]>([]);

  const adoptDto = useCallback((next: OwnerListingDto) => {
    dtoRef.current = next;
    setDto(next);
  }, []);

  const handleMutationError = useCallback((error: unknown): void => {
    if (error instanceof PublicApiError && error.code === "LISTING_REVISION_CONFLICT") {
      pendingRef.current = {};
      setConflict(true);
      conflictRef.current = true;
      return;
    }
    setSaveState("error");
    setSaveError(
      error instanceof PublicApiError && error.code === "LISTING_INVALID_CATALOG_SELECTION"
        ? "invalid_catalog"
        : "generic",
    );
  }, []);

  /** Runs one operation on the serialized chain. */
  const enqueue = useCallback(<T,>(op: () => Promise<T>): Promise<T | null> => {
    const run = chainRef.current.then(async () => {
      if (conflictRef.current) return null;
      return op();
    });
    chainRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const sendPending = useCallback(async (): Promise<boolean> => {
    const fields = pendingRef.current;
    if (Object.keys(fields).length === 0) return true;
    pendingRef.current = {};
    setSaveState("saving");
    setSaveError(null);
    try {
      const next = await patchListing(dtoRef.current.id, dtoRef.current.revision, fields);
      adoptDto(next);
      setSaveState(Object.keys(pendingRef.current).length > 0 ? "dirty" : "saved");
      return true;
    } catch (error) {
      handleMutationError(error);
      return false;
    }
  }, [adoptDto, handleMutationError]);

  const drain = useCallback(async () => {
    let ok = true;
    while (ok && Object.keys(pendingRef.current).length > 0 && !conflictRef.current) {
      ok = await sendPending();
    }
    const resolvers = flushResolversRef.current;
    flushResolversRef.current = [];
    for (const resolve of resolvers) resolve(ok && !conflictRef.current);
    return ok;
  }, [sendPending]);

  /** Merge fields into the pending patch; save after a debounce. */
  const patch = useCallback(
    (fields: PatchBody, options: { immediate?: boolean } = {}) => {
      if (conflictRef.current) return;
      pendingRef.current = { ...pendingRef.current, ...fields };
      setSaveState("dirty");
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (options.immediate === true) {
        timerRef.current = null;
        void enqueue(drain);
      } else {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          void enqueue(drain);
        }, DEBOUNCE_MS);
      }
    },
    [drain, enqueue],
  );

  /** Force-save everything pending; resolves once the queue is idle. */
  const flush = useCallback((): Promise<boolean> => {
    if (conflictRef.current) return Promise.resolve(false);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (Object.keys(pendingRef.current).length === 0) {
      // nothing pending, but wait for any in-flight op to settle
      return enqueue(async () => true).then((r) => r === true && !conflictRef.current);
    }
    return new Promise<boolean>((resolve) => {
      flushResolversRef.current.push(resolve);
      void enqueue(drain);
    });
  }, [drain, enqueue]);

  /**
   * Image mutations and submits: serialized with saves; pending field
   * edits are flushed first so `expected_revision` is current. After
   * the op the full DTO is refetched (image ops shift sort orders and
   * primary flags server-side).
   */
  const runExclusive = useCallback(
    <T,>(op: () => Promise<T>, options: { refetch?: boolean } = {}): Promise<T | null> => {
      return enqueue(async () => {
        let ok = true;
        while (ok && Object.keys(pendingRef.current).length > 0) {
          ok = await sendPending();
        }
        if (!ok || conflictRef.current) return null;
        try {
          const result = await op();
          if (options.refetch !== false) {
            adoptDto(await fetchOwnerListing(dtoRef.current.id));
          }
          return result;
        } catch (error) {
          if (error instanceof PublicApiError && error.code === "LISTING_REVISION_CONFLICT") {
            handleMutationError(error);
          }
          throw error;
        }
      });
    },
    [adoptDto, enqueue, handleMutationError, sendPending],
  );

  /** Explicit conflict recovery: adopt the server version, drop local edits. */
  const reloadFromServer = useCallback(async () => {
    const fresh = await fetchOwnerListing(dtoRef.current.id);
    pendingRef.current = {};
    conflictRef.current = false;
    adoptDto(fresh);
    setConflict(false);
    setSaveState("idle");
    setSaveError(null);
    setResetKey((k) => k + 1); // remounts field components onto fresh values
  }, [adoptDto]);

  const dirty = saveState === "dirty" || saveState === "saving";

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return useMemo(
    () => ({
      dto,
      saveState,
      dirty,
      conflict,
      saveError,
      resetKey,
      patch,
      flush,
      runExclusive,
      reloadFromServer,
      adoptDto,
    }),
    [dto, saveState, dirty, conflict, saveError, resetKey, patch, flush, runExclusive, reloadFromServer, adoptDto],
  );
}

export type ListingEditor = ReturnType<typeof useListingEditor>;
