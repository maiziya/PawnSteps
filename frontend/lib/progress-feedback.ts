import type { Task } from './types';

export interface ProgressFeedback {
  id: string;
  kind: 'step' | 'decrement' | 'daily' | 'complete';
  amount: number;
  fromProgress: number;
  fromToday: number;
}

export function progressChange(before: Task, after: Task): Omit<ProgressFeedback, 'id'> | null {
  if (before.owner_id !== after.owner_id) return null;
  const daily = after.daily_quota > 0 || after.daily_plan !== null;
  const amount = after.course_items !== null ? after.progress - before.progress
    : after.today_amount - before.today_amount || (daily ? 0 : after.progress - before.progress);
  if (!amount) return null;
  const kind = amount < 0 ? 'decrement' : !before.is_done && after.is_done ? 'complete'
    : !before.daily_done && after.daily_done ? 'daily' : 'step';
  return { kind, amount, fromProgress: before.progress, fromToday: before.today_amount };
}
