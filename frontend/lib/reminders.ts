import { ownerIdentity } from './api';

export interface ReminderState {
  time: string;
  timezone: string;
  server_now: string;
  date: string;
  due: boolean;
  claimed: boolean;
  token: string | null;
  title: string;
  body: string;
  task_count: number;
  url: string;
}
export const REMINDER_CHANGED = 'pawnsteps-reminder-changed';
export const reminderKey = (owner: string) => `pawnsteps-morning-reminder:${owner}`;
export const reminderEnabled = (owner: string) => localStorage.getItem(reminderKey(owner)) === 'true';
export function setReminderEnabled(owner: string, enabled: boolean) {
  localStorage.setItem(reminderKey(owner), String(enabled));
  window.dispatchEvent(new Event(REMINDER_CHANGED));
}
export function reminderDevice() {
  const key = 'pawnsteps-reminder-device';
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}
export const deliveredKey = (owner: string) => `pawnsteps-reminder-delivered:${owner}`;
export function notificationsAvailable() {
  return window.isSecureContext && typeof Notification !== 'undefined';
}
export function isReminderHour(time: number, timezone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(time)) === '10';
}
export function showReminder(owner: string, title: string, body: string, tag: string, url: string, silent = true) {
  if (ownerIdentity() !== owner || !notificationsAvailable() || Notification.permission !== 'granted') throw new Error('通知权限不可用');
  const notification = new Notification(title, { body, tag, icon: '/icon.svg', silent });
  notification.onclick = () => {
    if (ownerIdentity() === owner) { window.focus(); location.hash = url === '/#today' ? 'today' : 'tasks'; }
    notification.close();
  };
  return notification;
}

export function reminderDate(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
