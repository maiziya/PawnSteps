export interface CourseItem { name: string; done: boolean }
export interface Task {
  id: string; name: string; description: string; target: number; progress: number;
  is_done: boolean; done_at: string | null; priority: "high" | "medium" | "low";
  position: number; reward_id: string | null; daily_quota: number; daily_progress: number;
  daily_done: boolean; daily_date: string | null; daily_plan: number[] | null;
  plan_start_date: string | null; course_items: CourseItem[] | null;
  owner_id: string; created_at: string; updated_at: string;
}
export interface Reward {
  id: string; name: string; image_url: string | null; is_unlocked: boolean;
  position: number; streak_target: number | null; owner_id: string;
}
export interface Stats {
  total: number; completed: number; in_progress: number; xp: number;
  streak: number; today_completed: number; today_total: number;
}
export interface User {
  id: string; username: string | null; email: string | null; avatar_url: string | null;
  is_premium: boolean; has_password: boolean; created_at: string;
}
export interface MutationResponse {
  tasks: Task[]; rewards: Reward[]; stats: Stats; unlocked_reward: Reward | null;
  today: string; timezone: string;
  undo_token?: string | null; access_token?: string | null; user?: User | null;
  image_url?: string | null; authorization_url?: string | null;
  message?: string | null; retry_after?: number | null;
}
export interface HistoryEntry { task_id: string; task_name: string; date: string; completed: boolean }
export interface HistoryResponse { history: HistoryEntry[]; streak: number }
