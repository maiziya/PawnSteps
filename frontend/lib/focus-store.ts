"use client";
import { create } from "zustand";
import { api, ApiError, ownerIdentity } from "./api";
import { useAppStore } from "./store";
import type { MutationOptions } from "./store";
import type { FocusPhase, FocusState } from "./focus-types";

interface TimerStore {
  owner: string; data: FocusState | null; receivedAt: number; error: string | null;
  reset: (owner: string) => void;
  accept: (data: FocusState, owner: string) => void;
  refresh: (quiet?: boolean) => Promise<void>;
  write: (path: string, body?: unknown, options?: MutationOptions) => Promise<FocusState | null>;
  start: (taskId: string | null, phase?: FocusPhase) => Promise<void>;
}
let pendingStart: { owner: string; key: string; id: string } | null = null;
let pendingSettlement: { owner: string; id: string; completionHint?: MutationOptions["completionHint"] } | null = null;
let pendingRead: { owner: string; promise: Promise<void> } | null = null;
export const useFocusStore = create<TimerStore>((set, get) => ({
  owner: "", data: null, receivedAt: 0, error: null,
  reset: owner => { pendingStart = null; pendingSettlement = null; set({ owner, data: null, receivedAt: 0, error: null }); },
  accept: (data, owner) => {
    if (owner !== ownerIdentity() || data.owner_id !== owner) return;
    const current = get();
    // Keep uncertain confirmations actionable until their original response is retried.
    if (pendingSettlement?.owner === owner && data.active_session?.id !== pendingSettlement.id) return;
    if (current.owner !== owner) get().reset(owner);
    else if (current.data && Date.parse(current.data.server_now) > Date.parse(data.server_now)) return;
    else if (current.data?.generation === data.generation && (current.data.revision > data.revision || (current.data.revision === data.revision && Date.parse(current.data.server_now) > Date.parse(data.server_now)))) return;
    set({ data, owner, receivedAt: performance.now(), error: null });
  },
  refresh: (quiet = false) => {
    const owner = ownerIdentity();
    if (get().owner !== owner) get().reset(owner);
    if (pendingRead?.owner === owner) return pendingRead.promise;
    const promise = Promise.resolve().then(async () => {
      try { get().accept(await api<FocusState>("/focus"), owner); }
      catch (error) { if (owner === ownerIdentity() && (!quiet || !get().data)) set({ error: error instanceof Error ? error.message : "计时器暂时无法连接" }); }
      finally { if (pendingRead?.promise === promise) pendingRead = null; }
    });
    pendingRead = { owner, promise }; return promise;
  },
  write: async (path, body, options = {}) => {
    const owner = ownerIdentity();
    const settling = /^\/[^/]+\/settle$/.test(path);
    if (settling && (pendingSettlement?.owner !== owner || pendingSettlement.id !== path.split("/")[1])) {
      const taskId = get().data?.active_session?.task_id;
      const task = useAppStore.getState().tasks.find(task => task.id === taskId);
      pendingSettlement = { owner, id: path.split("/")[1], completionHint: task ? { taskId: task.id, wasDone: task.is_done } : undefined };
    }
    try {
      const result = await useAppStore.getState().mutate(`/focus${path}`, body, path === "/settings" ? "PATCH" : "POST", { ...options, expectedOwner: owner, ...(settling ? { completionHint: pendingSettlement?.completionHint } : {}) });
      if (settling) pendingSettlement = null;
      if (result.focus) {
        get().accept(result.focus, owner);
        if (owner === ownerIdentity() && typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel("pawnsteps-focus");
          channel.postMessage({ owner, generation: result.focus.generation, revision: result.focus.revision }); channel.close();
        }
      }
      return owner === ownerIdentity() ? result.focus || null : null;
    } catch (error) {
      if (settling && error instanceof ApiError && error.status < 500) pendingSettlement = null;
      if (error instanceof ApiError && error.status === 409) await get().refresh(true);
      throw error;
    }
  },
  start: async (taskId, phase = "focus") => {
    const owner = ownerIdentity(), key = `${phase}:${taskId || "free"}`;
    if (!pendingStart || pendingStart.owner !== owner || pendingStart.key !== key) pendingStart = { owner, key, id: crypto.randomUUID() };
    const attempt = pendingStart;
    try { await get().write("/start", { task_id: taskId, phase, request_id: attempt.id }); if (pendingStart === attempt) pendingStart = null; }
    catch (error) { if (error instanceof ApiError && error.status < 500 && pendingStart === attempt) pendingStart = null; throw error; }
  },
}));
