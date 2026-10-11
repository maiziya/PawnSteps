import type { Task } from './types';

export function recordStart(task: Task, timezone: string): string {
  if (task.record_start_date) return task.record_start_date;
  if (task.daily_plan && task.plan_start_date) return task.plan_start_date;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(task.created_at));
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`;
}

export function planQuota(task: Task, day: string): number | null {
  if (!task.daily_plan) return null;
  const index = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${task.plan_start_date}T00:00:00Z`)) / 86400000);
  return task.daily_plan[index] ?? -1;
}

export function canRecordOn(task: Task, day: string, today: string, timezone: string): boolean {
  if (task.archived_at || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today || day < recordStart(task, timezone)) return false;
  if (task.is_done && day < today && task.record_end_date && day > task.record_end_date) return false;
  const quota = planQuota(task, day);
  if (quota !== null) return quota > 0;
  return day < today || !task.is_done || task.daily_quota > 0 && task.daily_done;
}
