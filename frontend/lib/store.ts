"use client";
import { create } from "zustand";
import { toast } from "sonner";
import { api, ApiError, ownerIdentity } from "@/lib/api";
import { playSound } from "@/lib/audio";
import type { MutationResponse, Reward, Stats, Task, TodayPlan, User } from "@/lib/types";

const emptyStats: Stats = { total: 0, completed: 0, in_progress: 0, xp: 0, streak: 0, today_completed: 0, today_total: 0 };
export interface QuickFeedback {
  requestId: string;
  amount: number;
  previousProgress: number;
  previousToday: number;
  isRetry: boolean;
  wasComplete: boolean;
  keepVisible: boolean;
  phase: "saving" | "saved" | "failed";
  message?: string;
}
export interface CompletionUndo {
  taskId: string;
  recordId: string;
  requestId: string;
  ownerId: string;
  taskName: string;
  rewardId: string | null;
  toastVisible: boolean;
  pending: boolean;
}
const QUICK_FEEDBACK_HOLD_MS = 1100;
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation); queue = next.catch(() => undefined); return next;
}
export interface MutationOptions { expectedOwner?: string; quiet?: boolean; feedback?: boolean; completionHint?: { taskId: string; wasDone: boolean } }
interface AppState {
  tasks: Task[]; rewards: Reward[]; stats: Stats; user: User | null;
  today: string; timezone: string; todayPlan: TodayPlan;
  loading: boolean; busy: boolean; error: string | null; unlocked: Reward | null;
  muted: boolean; dark: boolean;
  quickFeedback: Record<string, QuickFeedback>;
  completionUndo: CompletionUndo | null;
  initialize: () => Promise<void>; refresh: () => Promise<void>;
  mutate: (path: string, body?: unknown, method?: string, options?: MutationOptions) => Promise<MutationResponse>;
  quickRecord: (taskId: string, amount: number) => Promise<void>;
  undoCompletion: () => Promise<void>;
  logout: () => Promise<void>; dismissUnlock: () => void;
  toggleMuted: () => void; toggleTheme: () => void;
}
export const useAppStore = create<AppState>((set, get) => {
  const completionToastId = (recordId: string) => `completion-${recordId}`;

  function closeCompletionToast(recordId: string) {
    const receipt = get().completionUndo;
    if (!receipt || receipt.recordId !== recordId || receipt.pending) return;
    if (receipt.rewardId && get().unlocked?.id === receipt.rewardId) {
      set({ completionUndo: { ...receipt, toastVisible: false } });
    } else set({ completionUndo: null });
  }

  function showCompletionToast(receipt: CompletionUndo, retry = false) {
    toast(retry ? '暂时未能撤回，请重试' : `已完成「${receipt.taskName}」`, {
      id: completionToastId(receipt.recordId), duration: 8000,
      action: { label: '撤销', onClick: event => { event.preventDefault(); void get().undoCompletion(); } },
      onAutoClose: () => closeCompletionToast(receipt.recordId),
      onDismiss: () => closeCompletionToast(receipt.recordId),
    });
  }

  function apply(data: MutationResponse, feedback = false, completionHint?: MutationOptions["completionHint"]) {
    const before = get();
    if (data.access_token) localStorage.setItem("pawnsteps-token", data.access_token);
    const unlocked = data.unlocked_reward || (feedback ? data.rewards.find(r => r.is_unlocked && before.rewards.some(old => old.id === r.id && !old.is_unlocked)) : null);
    const receipt = before.completionUndo;
    const receiptTask = receipt && data.tasks.find(task => task.id === receipt.taskId);
    const receiptInvalid = Boolean(receipt && (!receiptTask || !receiptTask.is_done || receiptTask.owner_id !== receipt.ownerId));
    if (receiptInvalid && receipt && !receipt.pending) toast.dismiss(completionToastId(receipt.recordId));
    const pendingUnlock = receiptInvalid && receipt?.rewardId === before.unlocked?.id ? null : before.unlocked;
    set({ tasks: data.tasks, rewards: data.rewards, stats: data.stats, error: null,
      today: data.today, timezone: data.timezone, todayPlan: data.today_plan || { date: data.today, task_ids: [] },
      completionUndo: receiptInvalid ? null : receipt, unlocked: unlocked || pendingUnlock,
      ...(data.user ? { user: data.user } : {}) });
    if (!feedback) return;
    const completedTask = data.record && !data.record.deleted_at && data.tasks.find(task => task.id === data.record!.task_id && task.is_done && (before.tasks.some(old => old.id === task.id && !old.is_done) || completionHint?.taskId === task.id && !completionHint.wasDone));
    if (completedTask && data.record) {
      if (receipt) toast.dismiss(completionToastId(receipt.recordId));
      const next: CompletionUndo = { taskId: completedTask.id, recordId: data.record.id, requestId: data.record.request_id || data.record.id,
        ownerId: completedTask.owner_id, taskName: completedTask.name, rewardId: unlocked?.id || null, toastVisible: true, pending: false };
      set({ completionUndo: next }); showCompletionToast(next);
    }
    if (unlocked) playSound("reward");
    else if (data.tasks.some(t => t.is_done && before.tasks.some(old => old.id === t.id && !old.is_done))) playSound("complete");
    else if (data.tasks.some(t => t.daily_done && before.tasks.some(old => old.id === t.id && !old.daily_done))) playSound("daily");
    else if (data.tasks.some(t => before.tasks.some(old => old.id === t.id && (t.progress > old.progress || t.daily_progress > old.daily_progress || t.today_amount > old.today_amount)))) playSound("step");
  }
  return {
    tasks: [], rewards: [], stats: emptyStats, user: null, today: "", timezone: "Asia/Shanghai", todayPlan: { date: "", task_ids: [] }, loading: true, busy: false, error: null, unlocked: null, muted: false, dark: false, quickFeedback: {}, completionUndo: null,
    initialize: async () => {
      const dark = localStorage.getItem("pawnsteps-theme") === "dark" || (!localStorage.getItem("pawnsteps-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
      set({ dark, muted: localStorage.getItem("pawnsteps-muted") === "true" });
      await get().refresh();
    },
    refresh: () => serial(async () => {
      try { apply(await api<MutationResponse>(localStorage.getItem("pawnsteps-token") ? "/profile" : "/state")); }
      catch (error) { set({ error: error instanceof Error ? error.message : "暂时无法连接服务" }); }
      finally { set({ loading: false }); }
    }),
    mutate: (path, body, method = "POST", options = {}) => serial(async () => {
      if (options.expectedOwner && options.expectedOwner !== ownerIdentity()) throw new Error("账号已切换，请重新操作");
      set({ busy: true });
      try {
        const data = await api<MutationResponse>(path, { method, ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
        if (options.expectedOwner && options.expectedOwner !== ownerIdentity()) throw new Error("账号已切换，请重新操作");
        apply(data, options.feedback !== false, options.completionHint);
        if (data.undo_token) {
          toast("任务已删除", { duration: 5000, action: { label: "撤销", onClick: () => { void get().mutate("/tasks/undo", { token: data.undo_token }).catch(() => undefined); } } });
        }
        return data;
      } catch (error) {
        if (!options.quiet) toast.error(error instanceof Error ? error.message : "操作未完成");
        if (error instanceof ApiError && error.status === 401 && localStorage.getItem("pawnsteps-token")) set({ error: "登录已过期，请在个人中心重新登录" });
        throw error;
      } finally { set({ busy: false }); }
    }),
    quickRecord: async (taskId, amount) => {
      const current = get();
      const task = current.tasks.find(item => item.id === taskId);
      const previous = current.quickFeedback[taskId];
      if (current.busy || previous?.phase === "saving" || ![-1, 1, 5].includes(amount) || !task || task.course_items !== null) return;
      const retry = previous?.phase === "failed" && previous.amount === amount;
      const isDaily = task.daily_quota > 0 || task.daily_plan !== null;
      const canRecord = !task.plan_expired && !(task.daily_plan !== null && task.daily_quota === 0) && (!task.is_done || (isDaily && task.daily_done));
      const canDecrement = !task.plan_expired && !(task.daily_plan !== null && task.daily_quota === 0) && (isDaily ? task.today_amount > 0 : task.progress > 0);
      const allowed = amount < 0 ? canDecrement : canRecord;
      if (!allowed && !retry) return;

      // Reuse the request ID when retrying an uncertain outcome for the same quantity.
      const requestId = retry ? previous.requestId : crypto.randomUUID();
      const feedback: QuickFeedback = {
        requestId, amount, phase: "saving", isRetry: retry, wasComplete: task.is_done,
        keepVisible: Boolean(task.is_done && previous?.phase === "saved" && (previous.keepVisible || (!previous.wasComplete && previous.previousProgress < task.target))),
        previousProgress: task.progress, previousToday: task.today_amount,
      };
      set(state => ({ quickFeedback: { ...state.quickFeedback, [taskId]: feedback } }));
      try {
        const response = amount < 0
          ? await get().mutate(`/tasks/${taskId}/decrement`, { request_id: requestId })
          : await get().mutate(`/tasks/${taskId}/records`, { amount, note: "", request_id: requestId });
        if (get().quickFeedback[taskId]?.requestId !== requestId) return;
        if (amount > 0 && response.record?.deleted_at) {
          set(state => {
            const next = { ...state.quickFeedback };
            delete next[taskId];
            return { quickFeedback: next };
          });
          toast("该记录已撤销，未重复添加");
          return;
        }
        set(state => ({ quickFeedback: { ...state.quickFeedback, [taskId]: { ...feedback, amount: amount < 0 ? -1 : response.record?.amount ?? amount, phase: "saved" } } }));
        setTimeout(() => {
          const active = get().quickFeedback[taskId];
          if (active?.requestId !== requestId || active.phase !== "saved") return;
          set(state => {
            const next = { ...state.quickFeedback };
            delete next[taskId];
            return { quickFeedback: next };
          });
        }, QUICK_FEEDBACK_HOLD_MS);
      } catch (error) {
        if (get().quickFeedback[taskId]?.requestId !== requestId) return;
        if (retry && !allowed && error instanceof ApiError && error.status >= 400 && error.status < 500) {
          set(state => {
            const next = { ...state.quickFeedback };
            delete next[taskId];
            return { quickFeedback: next };
          });
          return;
        }
        set(state => ({ quickFeedback: { ...state.quickFeedback, [taskId]: { ...feedback, phase: "failed", message: "保存未确认，再点一次重试" } } }));
      }
    },
    undoCompletion: async () => {
      const receipt = get().completionUndo;
      if (!receipt || receipt.pending) return;
      const task = get().tasks.find(item => item.id === receipt.taskId);
      if (!task || task.owner_id !== receipt.ownerId) {
        toast.dismiss(completionToastId(receipt.recordId));
        set({ completionUndo: null });
        return;
      }
      set({ completionUndo: { ...receipt, pending: true } });
      toast.loading('正在撤回最后一笔记录', { id: completionToastId(receipt.recordId), duration: Infinity, action: undefined });
      try {
        await get().mutate(`/tasks/${receipt.taskId}/records/${receipt.recordId}`, undefined, 'DELETE');
        set(state => {
          const next = { ...state.quickFeedback };
          if (next[receipt.taskId]?.requestId === receipt.requestId) delete next[receipt.taskId];
          return { quickFeedback: next, completionUndo: state.completionUndo?.recordId === receipt.recordId ? null : state.completionUndo };
        });
        toast.success('已撤回最后一笔记录', { id: completionToastId(receipt.recordId), duration: 3000, action: undefined });
        requestAnimationFrame(() => {
          const target = document.querySelector<HTMLButtonElement>(`[data-record-trigger="${receipt.taskId}"]`);
          if (!target) return;
          // Let the toaster restore its previous focus before selecting the restored card.
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && focused.closest('[data-sonner-toaster]')) focused.blur();
          target.focus({ preventScroll: true });
        });
      } catch {
        if (get().completionUndo?.recordId !== receipt.recordId) {
          toast.error('未能撤回，可在记录历史中重试', { id: completionToastId(receipt.recordId), duration: 4000, action: undefined });
          return;
        }
        const retryReceipt = { ...receipt, pending: false, toastVisible: true };
        set({ completionUndo: retryReceipt });
        showCompletionToast(retryReceipt, true);
      }
    },
    logout: () => serial(async () => {
      const receipt = get().completionUndo;
      if (receipt) toast.dismiss(completionToastId(receipt.recordId));
      localStorage.removeItem("pawnsteps-token");
      localStorage.removeItem("pawnsteps-guest-id");
      set({ user: null, tasks: [], rewards: [], stats: emptyStats, todayPlan: { date: "", task_ids: [] }, unlocked: null, loading: true, quickFeedback: {}, completionUndo: null });
      try { apply(await api<MutationResponse>("/state")); } catch (error) { set({ error: String(error) }); }
      finally { set({ loading: false }); }
    }),
    dismissUnlock: () => set(state => ({ unlocked: null, completionUndo: state.completionUndo?.rewardId === state.unlocked?.id && !state.completionUndo?.toastVisible ? null : state.completionUndo })),
    toggleMuted: () => { const muted = !get().muted; localStorage.setItem("pawnsteps-muted", String(muted)); set({ muted }); },
    toggleTheme: () => { const dark = !get().dark; localStorage.setItem("pawnsteps-theme", dark ? "dark" : "light"); document.documentElement.classList.toggle("dark", dark); set({ dark }); },
  };
});
