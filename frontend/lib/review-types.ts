export interface ReviewTask { task_id: string; name: string; unit: string; amount: number; achieved_days: number }
export interface ReviewDay { date: string; task_count: number; achieved_count: number; focus_seconds: number; is_rest: boolean; is_future: boolean; tasks: ReviewTask[] }
export interface ReviewSummary { active_tasks: number; active_days: number; achieved_days: number; completed_tasks: number; focus_seconds: number; pomodoros: number; quantities: Record<string, number> }
export interface ReviewPeriod { start: string; end: string; summary: ReviewSummary; days: ReviewDay[]; tasks: ReviewTask[] }
export interface WeeklyReview { today: string; timezone: string; week_start: string; week_end: string; through_date: string; is_current_week: boolean; elapsed_days: number; current: ReviewPeriod; previous: ReviewPeriod }
export function shiftDate(value: string, days: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
export function weekStart(value: string) { const day = new Date(`${value}T12:00:00Z`).getUTCDay(); return shiftDate(value, -((day + 6) % 7)); }
export function shortDate(value: string) { const [, month, day] = value.split('-'); return `${Number(month)}月${Number(day)}日`; }
export function focusDuration(seconds: number) { const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60); return hours ? `${hours}小时${minutes ? `${minutes}分` : ''}` : seconds >= 60 ? `${minutes}分钟` : `${seconds}秒`; }

export function compactFocusDuration(seconds: number) { return seconds >= 3600 ? `${Math.floor(seconds / 3600)}时` : seconds >= 60 ? `${Math.floor(seconds / 60)}分` : `${seconds}秒`; }
