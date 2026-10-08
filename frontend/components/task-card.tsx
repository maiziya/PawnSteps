'use client';

import { useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, useReducedMotion } from 'framer-motion';
import { BookOpen, CalendarDays, Check, Flag, Gift, GripVertical, Minus, MoreHorizontal, Plus, RotateCcw, Sun, Trash2 } from 'lucide-react';
import type { Task } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { CourseItems } from '@/components/course-items';

export function TaskCard({ task, onEdit }: { task: Task; onEdit: (task: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: task.is_done });
  const mutate = useAppStore(state => state.mutate);
  const busy = useAppStore(state => state.busy);
  const reward = useAppStore(state => state.rewards.find(reward => reward.id === task.reward_id));
  const reducedMotion = useReducedMotion();
  const isCourse = task.course_items !== null;
  const isPlan = task.daily_plan !== null;
  const isDaily = task.daily_quota > 0 || isPlan;
  const current = isDaily ? task.daily_progress : task.progress;
  const maximum = isDaily ? task.daily_quota : task.target;
  const [preview, setPreview] = useState(current);
  useEffect(() => setPreview(current), [current]);
  const restDay = isPlan && maximum === 0 && task.daily_done;
  const inactivePlan = isPlan && maximum === 0;
  const locked = Boolean(busy) || inactivePlan || (isDaily && task.is_done && !task.daily_done);
  const percent = maximum ? Math.min(100, (preview / maximum) * 100) : (task.daily_done || task.is_done ? 100 : 0);
  const Icon = isCourse ? BookOpen : isPlan ? CalendarDays : isDaily ? Sun : Flag;
  const kind = isCourse ? '课程学习' : isPlan ? '天数计划' : isDaily ? '每日打卡' : '目标任务';
  const priority = { high: '高优先级', medium: '中优先级', low: '低优先级' }[task.priority];

  async function commit(value: number) {
    if (locked || value === current) return;
    const bounded = Math.max(0, Math.min(maximum, value));
    setPreview(bounded);
    try { await mutate(`/tasks/${task.id}/${isDaily ? 'daily' : 'progress'}`, { progress: bounded }); }
    catch { setPreview(current); }
  }

  async function remove() {
    try { await mutate(`/tasks/${task.id}`, undefined, 'DELETE'); } catch { /* Store displays the error. */ }
  }

  async function undoDay() {
    try { await mutate(`/tasks/${task.id}/daily/undo`); } catch { /* Store displays the error. */ }
  }

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 20 : undefined }} className="relative">
      <motion.article layout={!isDragging && !reducedMotion} initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`panel task-card p-5 sm:p-6 ${task.is_done ? 'task-completed' : ''}`}>
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${task.is_done ? 'bg-[var(--success)]/12 text-[var(--success)]' : 'bg-[var(--background)] text-[var(--primary)]'}`}>
            {task.is_done ? <motion.span key="check" initial={reducedMotion ? false : { scale: 0.6 }} animate={{ scale: 1 }}><Check size={21} /></motion.span> : <Icon size={20} strokeWidth={1.7} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
              <span>{kind}</span>
              <span className={`flex items-center gap-1 ${task.priority === 'high' ? 'text-[var(--primary)]' : ''}`}><span className={`h-1.5 w-1.5 rounded-full ${task.priority === 'high' ? 'bg-[var(--primary)]' : task.priority === 'medium' ? 'bg-[var(--accent)]' : 'bg-[var(--muted)]/40'}`} />{priority}</span>
            </div>
            <h3 className={`break-words text-base font-semibold leading-relaxed sm:text-[17px] ${task.is_done ? 'text-[var(--muted)]' : ''}`}>{task.name}</h3>
            {task.description && <p className="mt-1 break-words text-sm leading-relaxed text-[var(--muted)]">{task.description}</p>}
          </div>
          <div className="-mr-2 -mt-2 flex shrink-0">
            <button type="button" onClick={() => onEdit(task)} className="icon-button" aria-label={`编辑${task.name}`} title="编辑任务"><MoreHorizontal size={18} /></button>
            {!task.is_done && <button type="button" {...attributes} {...listeners} className="icon-button touch-none cursor-grab active:cursor-grabbing" aria-label={`拖动排序${task.name}`} title="拖动排序"><GripVertical size={17} /></button>}
          </div>
        </div>

        {isCourse ? <>
          <div className="mt-5 flex items-center justify-between text-xs text-[var(--muted)]"><span>{task.is_done ? '课程已完成' : '学习进度'}</span><span className="tabular-nums">{task.progress} / {task.target} 节</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full rounded-full bg-[var(--success)] transition-[width]" style={{ width: `${task.target ? task.progress / task.target * 100 : 0}%` }} /></div>
          <CourseItems task={task} />
        </> : <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-2 text-xs">
            <span className={task.daily_done || task.is_done ? 'text-[var(--success)]' : 'text-[var(--muted)]'}>{restDay ? '今天是休息日，安心休息' : isPlan && maximum === 0 ? (task.is_done ? '计划已完成' : `${task.plan_start_date} 开始`) : isDaily ? (task.daily_done ? '今日已达标' : '今日进度') : task.is_done ? '目标已完成' : '每一步，都算数'}</span>
            <span className="shrink-0 tabular-nums text-[var(--muted)]">{isDaily ? `${task.progress} / ${task.target} ${isPlan ? '步' : '天'}` : `${task.progress} / ${task.target} 步`}</span>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" disabled={locked || preview <= 0} className="icon-button shrink-0 rounded-full border border-[var(--border)]" aria-label={`${task.name}减少一步`} onClick={() => void commit(preview - 1)}><Minus size={16} /></button>
            <div className="relative flex h-11 flex-1 items-center">
              <div className="pointer-events-none absolute left-0 right-0 h-2 overflow-hidden rounded-full bg-[var(--border)]"><div className={`h-full rounded-full transition-[width] duration-150 ${percent >= 100 ? 'bg-[var(--success)]' : 'bg-[var(--primary)]'}`} style={{ width: `${percent}%` }} /></div>
              <input type="range" min={0} max={Math.max(1, maximum)} step={1} value={inactivePlan ? (task.daily_done || task.is_done ? 1 : 0) : preview} disabled={locked} aria-label={`${task.name}${isDaily ? '今日' : ''}进度`} aria-valuetext={`${preview} / ${maximum}`} onChange={event => setPreview(Number(event.target.value))} onPointerUp={event => void commit(Number(event.currentTarget.value))} onPointerCancel={() => setPreview(current)} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) void commit(Number(event.currentTarget.value)); }} className="task-range relative z-10 w-full cursor-pointer disabled:cursor-default" />
            </div>
            <button type="button" disabled={locked || preview >= maximum} className="icon-button shrink-0 rounded-full border border-[var(--border)]" aria-label={`${task.name}增加一步`} onClick={() => void commit(preview + 1)}><Plus size={16} /></button>
            <span className="w-9 shrink-0 text-right text-sm font-semibold tabular-nums">{inactivePlan ? '—' : preview}</span>
          </div>
        </div>}

        <div className="-mb-2 mt-3 flex min-h-10 items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
          {reward ? <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]"><Gift size={13} className="shrink-0" /><span className="truncate">{reward.name}</span></span> : <span className="text-xs text-[var(--muted)]">{isDaily && maximum > 0 ? `每日 ${maximum} 步的小积累` : task.is_done ? '又向前走了一步' : '专注当下这一小步'}</span>}
          <div className="-mr-2 flex items-center">
            {isDaily && task.daily_done && !restDay && <button type="button" disabled={Boolean(busy)} onClick={() => void undoDay()} className="flex min-h-11 items-center gap-1 px-2 text-xs text-[var(--muted)]" title="撤销今日达标"><RotateCcw size={13} />撤销达标</button>}
            <button type="button" disabled={Boolean(busy)} onClick={() => void remove()} className="icon-button text-[var(--muted)]" aria-label={`删除${task.name}`} title="删除任务，可在 5 秒内撤销"><Trash2 size={14} /></button>
          </div>
        </div>
      </motion.article>
    </div>
  );
}
