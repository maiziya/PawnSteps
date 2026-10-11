'use client';

import { useEffect, useState } from 'react';
import { Bell, Check, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ownerIdentity } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { deliveredKey, isReminderHour, notificationsAvailable, REMINDER_CHANGED, reminderDate, reminderDevice, reminderEnabled, reminderKey, setReminderEnabled, showReminder, type ReminderState } from '@/lib/reminders';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import './daily-reminder.css';

export function DailyReminderProvider() {
  const userId = useAppStore(state => state.user?.id);
  const loading = useAppStore(state => state.loading);
  useEffect(() => {
    if (loading) return;
    const owner = ownerIdentity();
    let active = true, checking = false;
    let clock: { state: ReminderState; receivedAt: number } | null = null;
    const notifications = new Set<Notification>();
    const closeNotifications = () => { notifications.forEach(notification => notification.close()); notifications.clear(); };
    async function check(syncClock = false) {
      if (!active || checking || ownerIdentity() !== owner) return;
      if (!reminderEnabled(owner)) { closeNotifications(); return; }
      if (!notificationsAvailable() || Notification.permission !== 'granted') return;
      checking = true;
      try {
        if (!clock || syncClock) {
          const config = await api<ReminderState>('/reminders');
          clock = { state: config, receivedAt: Date.now() };
        }
        if (!active || ownerIdentity() !== owner || !reminderEnabled(owner)) return;
        const serverTime = Date.parse(clock.state.server_now) + Date.now() - clock.receivedAt;
        if (!isReminderHour(serverTime, clock.state.timezone)) return;
        const day = reminderDate(serverTime, clock.state.timezone);
        if (localStorage.getItem(deliveredKey(owner)) === day) return;
        const device = reminderDevice();
        const result = await useAppStore.getState().mutate('/reminders/claim', { device_id: device }, 'POST', { feedback: false, quiet: true, expectedOwner: owner });
        const reminder = result.reminder;
        if (!reminder?.claimed || !reminder.token) return;
        const receipt = { device_id: device, date: reminder.date, token: reminder.token };
        if (!active || ownerIdentity() !== owner || !reminderEnabled(owner) || Notification.permission !== 'granted') {
          if (ownerIdentity() === owner) await api('/reminders/release', { method: 'POST', body: JSON.stringify(receipt) });
          return;
        }
        let shown = false;
        try {
          const notification = showReminder(owner, reminder.title, reminder.body, `pawnsteps-morning-${reminder.date}`, reminder.url, useAppStore.getState().muted);
          shown = true;
          notifications.add(notification);
          notification.onclose = () => notifications.delete(notification);
          localStorage.setItem(deliveredKey(owner), reminder.date);
          // The server receipt coordinates tabs; this marker also covers an uncertain acknowledgement.
          await api('/reminders/ack', { method: 'POST', body: JSON.stringify(receipt) });
        } catch {
          if (!shown && ownerIdentity() === owner) await api('/reminders/release', { method: 'POST', body: JSON.stringify(receipt) });
        }
      } catch { /* Network errors are retried on the next check without an intrusive toast. */ }
      finally { checking = false; }
    }
    const refresh = () => { void check(true); };
    const storage = (event: StorageEvent) => { if (event.key === reminderKey(owner)) refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    void check(true);
    const timer = setInterval(() => { void check(); }, 30000);
    window.addEventListener(REMINDER_CHANGED, refresh);
    window.addEventListener('storage', storage);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false; clearInterval(timer); closeNotifications();
      window.removeEventListener(REMINDER_CHANGED, refresh);
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [userId, loading]);
  return null;
}

export function DailyReminderControl() {
  const userId = useAppStore(state => state.user?.id);
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [supported, setSupported] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const refresh = () => {
      setSupported(notificationsAvailable());
      setPermission(typeof Notification === 'undefined' ? 'default' : Notification.permission);
      setEnabled(reminderEnabled(ownerIdentity()));
    };
    refresh();
    window.addEventListener(REMINDER_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener(REMINDER_CHANGED, refresh); window.removeEventListener('storage', refresh); window.removeEventListener('focus', refresh); };
  }, [userId]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void api<ReminderState>('/reminders', { signal: controller.signal }).then(data => setTimezone(data.timezone)).catch(() => undefined);
    return () => controller.abort();
  }, [open]);
  async function enable() {
    const owner = ownerIdentity();
    setPending(true); setError('');
    try {
      const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      setPermission(result);
      if (ownerIdentity() !== owner) return;
      if (result !== 'granted') { setError('请在浏览器的网站设置中允许 PawnSteps 发送通知。'); return; }
      setReminderEnabled(owner, true);
      toast.success('已开启每天 10:00 提醒');
    } catch { setError('暂时无法开启，请检查浏览器通知权限后重试。'); }
    finally { setPending(false); }
  }
  const active = enabled && permission === 'granted';
  const status = !supported ? '请使用支持通知的浏览器，并通过 HTTPS 或 localhost 打开。' : permission === 'denied' ? '通知被浏览器拦截，请在网站设置中允许通知。' : active ? '已开启 · 当前浏览器' : '尚未开启';
  return <>
    <button type="button" className={`icon-button reminder-toggle ${active ? 'is-enabled' : ''}`} aria-label="每日提醒" title="每日 10:00 提醒" onClick={() => { setError(''); setOpen(true); }}><Bell size={19} /></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="daily-reminder-dialog">
      <DialogTitle className="daily-reminder-title"><Bell size={20} />每日提醒</DialogTitle>
      <DialogDescription>留一点提醒，给每天的第一步。</DialogDescription>
      <div className="daily-reminder-time"><Clock3 size={22} /><strong>10:00</strong><span>每天上午<small>{timezone === 'Asia/Shanghai' ? '北京时间' : timezone}</small></span></div>
      <p className="daily-reminder-status">{active && <Check size={15} />}{status}</p>
      <p className="daily-reminder-copy">提醒当天需要执行、尚未达标的任务。点击 Mac 通知即可回到任务列表；全部达标时不打扰。</p>
      <p className="daily-reminder-note">需保持网页打开，可以放在后台。Mac 休眠或浏览器后台限制可能使提醒延迟；关闭网页后暂不提醒。</p>
      {error && <p className="daily-reminder-error" role="alert">{error}</p>}
      <div className="daily-reminder-actions">
        {enabled ? <Button variant="outline" disabled={pending} onClick={() => { try { setReminderEnabled(ownerIdentity(), false); setError(''); toast('每日提醒已关闭'); } catch { setError('设置未能保存，请重试。'); } }}>关闭提醒</Button> : <Button disabled={!supported || permission === 'denied' || pending} onClick={() => void enable()}>{pending ? '正在开启…' : '开启提醒'}</Button>}
        <Button variant="outline" disabled={!supported || permission !== 'granted' || pending} onClick={() => {
          try { showReminder(ownerIdentity(), 'PawnSteps · 测试提醒', '每天上午 10:00，提醒你开始当天的小目标。', 'pawnsteps-reminder-test', '/#tasks'); setError(''); toast('测试通知已发送，请查看 Mac 通知中心'); }
          catch { setError('通知未能发送，请检查浏览器和 Mac 系统通知设置。'); }
        }}>测试通知</Button>
      </div>
    </DialogContent></Dialog>
  </>;
}
