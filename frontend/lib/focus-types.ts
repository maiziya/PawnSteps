export type FocusPhase = "focus" | "short_break" | "long_break";
export interface FocusSettings {
  focus_minutes: number; short_break_minutes: number; long_break_minutes: number;
  long_break_interval: number; auto_start_break: boolean; rounds_completed: number;
}
export interface FocusSession {
  id: string; task_id: string | null; task_name: string; task_unit: string; is_course: boolean;
  can_record: boolean; phase: FocusPhase; status: "running" | "paused" | "completed" | "ended";
  duration_seconds: number; elapsed_seconds: number; remaining_seconds: number;
  deadline_at: string | null; started_at: string; ended_at: string | null; settled_at: string | null;
  cycle_round: number; cycle_length: number; progress_record_id: string | null;
}
export interface FocusState {
  owner_id: string; generation: string; revision: number; server_now: string;
  settings: FocusSettings; active_session: FocusSession | null;
  summary: { today_seconds: number; today_pomodoros: number; total_pomodoros: number };
  recent_sessions: FocusSession[]; notification_claimed: boolean;
}
export interface FocusSettlement { record_progress: boolean; amount?: number; course_indices?: number[]; note?: string }
export const phaseLabels: Record<FocusPhase, string> = { focus: "专注", short_break: "短休息", long_break: "长休息" };
export function clockText(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function durationText(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} 分 ${Math.floor(seconds % 60)} 秒` : `${Math.floor(seconds)} 秒`;
}
