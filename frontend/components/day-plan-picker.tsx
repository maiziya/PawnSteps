"use client";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Flag, Search, Sun } from "lucide-react";
import { toast } from "sonner";
import { ApiError, ownerIdentity } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { Task } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import "./day-plan.css";

export function availableForPlan(task: Task) {
  return !task.is_done && !task.plan_expired && !(task.daily_plan !== null && task.daily_quota <= 0);
}
export function DayPlanPicker({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const tasks = useAppStore(state => state.tasks), plan = useAppStore(state => state.todayPlan), userId = useAppStore(state => state.user?.id), busy = useAppStore(state => state.busy);
  const [selected, setSelected] = useState<string[]>([]), [query, setQuery] = useState(''), [saving, setSaving] = useState(false);
  const origin = useRef<{ owner: string; date: string } | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const taskNames = useRef(new Map<string, string>());
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) { origin.current = null; taskNames.current.clear(); return; }
    if (!origin.current) {
      origin.current = { owner: ownerIdentity(), date: plan.date };
      setSelected([...plan.task_ids]); setQuery('');
    } else if (origin.current.owner !== ownerIdentity() || origin.current.date !== plan.date) {
      onCloseRef.current(); toast('日期或账号已更新，请重新选择今日计划');
    }
    const storage = () => { if (origin.current && origin.current.owner !== ownerIdentity()) onCloseRef.current(); };
    window.addEventListener('storage', storage); return () => window.removeEventListener('storage', storage);
  }, [open, plan.date, userId]);
  useEffect(() => {
    if (open) tasks.forEach(task => taskNames.current.set(task.id, task.name));
  }, [open, tasks]);
  const retained = (id: string) => plan.task_ids.includes(id);
  const eligible = (task: Task) => availableForPlan(task) || retained(task.id);
  const candidates = tasks.filter(task => eligible(task) || selected.includes(task.id));
  const visible = candidates.filter(task => task.name.toLowerCase().includes(query.trim().toLowerCase()));
  const unavailable = selected.filter(id => !tasks.some(task => task.id === id));
  const invalid = selected.some(id => { const task = tasks.find(task => task.id === id); return !task || !eligible(task); });
  function toggle(id: string) {
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 3 ? [...current, id] : current);
  }
  async function save() {
    const snapshot = origin.current;
    if (!snapshot || saving || busy || invalid) return;
    setSaving(true);
    try {
      await useAppStore.getState().mutate('/day-plan', { date: snapshot.date, task_ids: selected }, 'PUT', { expectedOwner: snapshot.owner, feedback: false });
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && [404, 409].includes(error.status)) await useAppStore.getState().refresh();
    } finally { setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value && !saving) onClose(); }}><DialogContent className="day-plan-dialog" onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus({ preventScroll: true }); }}>
    <div className="day-plan-heading"><DialogTitle ref={title} tabIndex={-1}>今天最重要的事</DialogTitle><DialogDescription>从已有任务里选出最多 3 项，按你的节奏推进。</DialogDescription></div>
    {candidates.length > 6 && <div className="day-plan-search"><Search size={16} /><Input aria-label="搜索计划任务" placeholder="搜索任务" value={query} onChange={event => setQuery(event.target.value)} /></div>}
    <div className="day-plan-options" role="group" aria-label="选择今日任务">{visible.length ? visible.map(task => {
      const checked = selected.includes(task.id), canSelect = eligible(task), Icon = task.course_items ? BookOpen : task.daily_quota > 0 ? Sun : Flag;
      const disabled = saving || busy || !checked && (selected.length >= 3 || !canSelect);
      return <label key={task.id} className={`day-plan-option ${checked ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(task.id)} />
        <Icon size={17} aria-hidden="true" /><span><strong>{task.name}</strong><small>{!canSelect ? '今日不可执行，请调整选择' : task.is_done ? '目标已完成，可保留或移出计划' : !task.is_scheduled_today && task.today_amount === 0 ? '今日休息，可自愿推进' : task.course_items ? `已学 ${task.progress} / ${task.target} 节` : `今日 ${task.today_amount} ${task.unit}`}</small></span>{checked && <Check size={16} aria-hidden="true" />}
      </label>;
    }) : !unavailable.length && <p className="day-plan-empty">{query ? '没有匹配的任务' : '先创建一个任务，再安排今天的计划。'}</p>}
    {unavailable.map(id => <label key={id} className="day-plan-option is-selected">
      <input type="checkbox" checked disabled={saving || busy} onChange={() => toggle(id)} />
      <Flag size={17} aria-hidden="true" /><span><strong>{taskNames.current.get(id) || '已移除的任务'}</strong><small>任务已删除，撤销删除后可恢复；也可取消选择。</small></span>
    </label>)}</div>
    <div className="day-plan-footer"><span aria-live="polite">已选 {selected.length} / 3 项</span><Button disabled={saving || busy || invalid || !plan.date} onClick={() => void save()}>{saving ? '正在保存' : selected.length ? '保存计划' : '清空计划'}</Button></div>
  </DialogContent></Dialog>;
}
