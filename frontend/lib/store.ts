"use client";
import { create } from "zustand";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { playSound } from "@/lib/audio";
import type { MutationResponse, Reward, Stats, Task, User } from "@/lib/types";

const emptyStats: Stats = { total: 0, completed: 0, in_progress: 0, xp: 0, streak: 0, today_completed: 0, today_total: 0 };
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation); queue = next.catch(() => undefined); return next;
}
interface AppState {
  tasks: Task[]; rewards: Reward[]; stats: Stats; user: User | null;
  today: string; timezone: string;
  loading: boolean; busy: boolean; error: string | null; unlocked: Reward | null;
  muted: boolean; dark: boolean;
  initialize: () => Promise<void>; refresh: () => Promise<void>;
  mutate: (path: string, body?: unknown, method?: string) => Promise<MutationResponse>;
  logout: () => Promise<void>; dismissUnlock: () => void;
  toggleMuted: () => void; toggleTheme: () => void;
}
export const useAppStore = create<AppState>((set, get) => {
  function apply(data: MutationResponse, feedback = false) {
    const before = get();
    if (data.access_token) localStorage.setItem("pawnsteps-token", data.access_token);
    const unlocked = data.unlocked_reward || (feedback ? data.rewards.find(r => r.is_unlocked && before.rewards.some(old => old.id === r.id && !old.is_unlocked)) : null);
    set({ tasks: data.tasks, rewards: data.rewards, stats: data.stats, error: null,
      today: data.today, timezone: data.timezone,
      ...(data.user ? { user: data.user } : {}), ...(unlocked ? { unlocked } : {}) });
    if (!feedback) return;
    if (unlocked) playSound("reward");
    else if (data.tasks.some(t => t.is_done && before.tasks.some(old => old.id === t.id && !old.is_done))) playSound("complete");
    else if (data.tasks.some(t => t.daily_done && before.tasks.some(old => old.id === t.id && !old.daily_done))) playSound("daily");
    else if (data.tasks.some(t => before.tasks.some(old => old.id === t.id && (t.progress > old.progress || t.daily_progress > old.daily_progress)))) playSound("step");
  }
  return {
    tasks: [], rewards: [], stats: emptyStats, user: null, today: "", timezone: "Asia/Shanghai", loading: true, busy: false, error: null, unlocked: null, muted: false, dark: false,
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
    mutate: (path, body, method = "POST") => serial(async () => {
      set({ busy: true });
      try {
        const data = await api<MutationResponse>(path, { method, ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
        apply(data, true);
        if (data.undo_token) {
          toast("任务已删除", { duration: 5000, action: { label: "撤销", onClick: () => { void get().mutate("/tasks/undo", { token: data.undo_token }).catch(() => undefined); } } });
        }
        return data;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "操作未完成");
        if (error instanceof ApiError && error.status === 401 && localStorage.getItem("pawnsteps-token")) set({ error: "登录已过期，请在个人中心重新登录" });
        throw error;
      } finally { set({ busy: false }); }
    }),
    logout: () => serial(async () => {
      localStorage.removeItem("pawnsteps-token");
      localStorage.removeItem("pawnsteps-guest-id");
      set({ user: null, tasks: [], rewards: [], stats: emptyStats, unlocked: null, loading: true });
      try { apply(await api<MutationResponse>("/state")); } catch (error) { set({ error: String(error) }); }
      finally { set({ loading: false }); }
    }),
    dismissUnlock: () => set({ unlocked: null }),
    toggleMuted: () => { const muted = !get().muted; localStorage.setItem("pawnsteps-muted", String(muted)); set({ muted }); },
    toggleTheme: () => { const dark = !get().dark; localStorage.setItem("pawnsteps-theme", dark ? "dark" : "light"); document.documentElement.classList.toggle("dark", dark); set({ dark }); },
  };
});
