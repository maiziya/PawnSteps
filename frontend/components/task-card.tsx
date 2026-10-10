'use client';

import { useId, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, useReducedMotion } from 'framer-motion';
import { Archive, ArrowRight, BookOpen, CalendarDays, FileText, Folder, Flag, Gift, GripVertical, History, MoreHorizontal, Pencil, Sun, Timer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ownerIdentity } from '@/lib/api';
import type { Task } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { TaskProgress } from './task-progress';
import { CompletionMark } from './completion-mark';
import { scheduleLabel } from './schedule-fields';
import { CategoryAssignment, CategoryBadge } from './task-categories';
import './task-card.css';

interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
  onOpenCourse: (taskId: string) => void;
  onOpenRecords: (taskId: string) => void;
  onStartFocus: (taskId: string) => void;
  focusAction?: boolean;
}

export function TaskCard({ task, onEdit, onOpenCourse, onOpenRecords, onStartFocus, focusAction = false }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: task.is_done });
  const mutate = useAppStore(state => state.mutate);
  const busy = useAppStore(state => state.busy);
  const timezone = useAppStore(state => state.timezone);
  const today = useAppStore(state => state.today);
  const quickRecord = useAppStore(state => state.quickRecord);
  const feedback = useAppStore(state => state.quickFeedback[task.id]);
  const progressEffect = useAppStore(state => state.progressFeedback[task.id]);
  const reward = useAppStore(state => state.rewards.find(reward => reward.id === task.reward_id));
  const reducedMotion = useReducedMotion();
  const descriptionId = useId();
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const isCourse = task.course_items !== null;
  const isPlan = task.daily_plan !== null;
  const isDaily = task.daily_quota > 0 || isPlan;
  const dailyMinimum = task.daily_quota || task.daily_minimum;
  const dailyGoal = task.daily_goal ?? dailyMinimum;
  const restDay = isPlan && task.daily_quota === 0 && task.daily_done;
  const inactivePlan = isPlan && task.daily_quota === 0;
  const canRecord = !task.plan_expired && !inactivePlan && (!task.is_done || (isDaily && task.daily_done));
  const canDecrement = !task.plan_expired && !inactivePlan && (isDaily ? task.today_amount > 0 : task.progress > 0);
  const saving = feedback?.phase === 'saving';
  const previewing = saving && !feedback.isRetry && !(feedback.amount < 0 && !isDaily && feedback.wasComplete);
  const useDailyMeter = isDaily && task.daily_quota > 0 && !task.plan_expired && (!task.is_done || task.daily_done || task.today_amount > 0);
  const todayAmount = previewing ? Math.max(0, feedback.previousToday + feedback.amount) : task.today_amount;
  const meterMaximum = useDailyMeter ? dailyGoal : task.target;
  const meterCurrent = useDailyMeter ? Math.min(meterMaximum, todayAmount) : Math.max(0, Math.min(task.target, previewing ? feedback.previousProgress + feedback.amount : task.progress));

  const Icon = isCourse ? BookOpen : isPlan ? CalendarDays : isDaily ? Sun : Flag;
  const priority = { high: '高优先级', medium: '中优先级', low: '低优先级' }[task.priority];
  const detailsLabel = task.description ? '说明' : '详情';
  const totalUnit = isCourse ? '节' : isDaily && !isPlan ? '天' : task.unit;

  const minimumLabel = restDay ? '今日休息' : inactivePlan ? (task.plan_expired ? '计划已结束' : `${task.plan_start_date} 开始`) : dailyMinimum > 0 ? `最小完成 ${dailyMinimum} ${task.unit}` : '最小完成 未设置';

  const meterCaption = useDailyMeter ? '今日进度' : '总进度';
  const frequencyLabel = scheduleLabel(task.schedule);
  const overdue = Boolean(task.deadline && today && task.deadline < today && !task.is_done);
  const deadlineDate = task.deadline ? (task.deadline.slice(0, 4) === today.slice(0, 4) ? task.deadline.slice(5) : task.deadline).replaceAll('-', '/') : '';
  const deadlineLabel = task.deadline === today && !task.is_done ? '今天截止' : `${overdue ? '已逾期' : '截止'} ${deadlineDate}`;
  const activitySummary = task.is_done && todayAmount === 0 ? '已完成' : task.schedule.mode === 'weekly' ? `本周 ${task.weekly_completed} / ${task.weekly_target} 天`
    : !task.is_scheduled_today && !task.daily_done && todayAmount === 0 && task.schedule.mode === 'weekdays' ? '今日休息'
    : restDay || inactivePlan ? minimumLabel : `今日 ${todayAmount}${dailyGoal > 0 ? ` / ${dailyGoal}` : ''} ${task.unit}`;

  async function archive() {
    const owner = ownerIdentity();
    try {
      await mutate(`/tasks/${task.id}/archive`, undefined, 'POST', { feedback: false, expectedOwner: owner });
      toast('任务已归档，历史记录保留', { duration: 5000, action: { label: '恢复', onClick: () => {
        void mutate(`/tasks/${task.id}/restore`, undefined, 'POST', { feedback: false, expectedOwner: owner }).catch(() => undefined);
      } } });
    } catch { /* Store displays the error. */ }
  }

  async function remove() {
    try { await mutate(`/tasks/${task.id}`, undefined, 'DELETE'); } catch { /* Store displays the error. */ }
  }

  async function record(amount: number) {
    const allowed = amount < 0 ? canDecrement : canRecord;
    const retry = feedback?.phase === 'failed' && feedback.amount === amount;
    if ((!allowed && !retry) || busy || saving) return;
    try { await quickRecord(task.id, amount); } catch { /* Store keeps the failed request available for retry. */ }
  }

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 20 : undefined }} className="task-sortable">
      <motion.article data-quick-task={task.id} layout={!isDragging && !reducedMotion} initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`panel task-card compact-task-card ${task.is_done ? 'task-completed' : ''} ${progressEffect?.kind === 'complete' ? 'is-celebrating' : ''}`}>
        <div className="compact-task-heading">
          <div className={`compact-task-icon ${task.is_done ? 'is-complete' : ''}`} aria-hidden="true">
            {task.is_done ? <CompletionMark celebrate={progressEffect?.kind === 'complete'} /> : <Icon size={19} strokeWidth={1.7} />}
          </div>
          <div className="compact-task-title">
            <div className="compact-task-name-row">
              <h3 title={task.name}>{task.name}</h3><CategoryBadge categoryId={task.category_id} />
              {task.priority === 'high' && <span className="compact-task-priority priority-high" title={priority} aria-label={priority}>优先</span>}
              {reward && <span className="compact-task-reward" title={`关联奖励：${reward.name}`} aria-label={`关联奖励：${reward.name}`}><Gift size={14} aria-hidden="true" /></span>}
            </div>
            {(!isCourse || dailyGoal > 0 || task.deadline) && <div className="compact-task-meta">
              {(!isCourse || dailyGoal > 0) && <span className={task.daily_done || task.is_done ? 'is-complete' : undefined} aria-label={`${task.name}已完成量`} title={`${dailyGoal > 0 ? `每日目标 ${dailyGoal} ${task.unit}，` : ''}${minimumLabel}`}>{activitySummary}</span>}
              {task.deadline && <span className={`task-deadline ${overdue ? 'is-overdue' : ''}`} title={`截止日期：${task.deadline}`}><CalendarDays size={12} aria-hidden="true" /><time dateTime={task.deadline}>{deadlineLabel}</time></span>}
            </div>}
          </div>
          <div className="compact-task-actions">
            {!task.is_done && <button type="button" {...attributes} {...listeners} disabled={busy} className="icon-button compact-task-button compact-task-drag" aria-label={`拖动排序${task.name}`} title="拖动排序"><GripVertical size={17} /></button>}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button type="button" className="icon-button compact-task-button" data-category-trigger={task.id} data-record-trigger={focusAction && !task.is_done ? task.id : undefined} aria-label={`任务操作：${task.name}`} title="任务操作"><MoreHorizontal size={20} /></button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="task-action-menu" align="end" sideOffset={6} collisionPadding={12}>
                  {!task.is_done && <DropdownMenu.Item disabled={busy || saving} className="task-action-item" onSelect={() => onStartFocus(task.id)}><Timer size={16} />开始专注</DropdownMenu.Item>}
                  <DropdownMenu.Item disabled={busy || saving} className="task-action-item" aria-label={`设置${task.name}分类`} onSelect={() => setCategoryOpen(true)}><Folder size={16} />设置分类</DropdownMenu.Item>
                  <DropdownMenu.Item disabled={busy || saving} className="task-action-item" aria-label={`编辑${task.name}`} onSelect={() => onEdit(task)}><Pencil size={16} />编辑任务</DropdownMenu.Item>
                  {!isCourse && <DropdownMenu.Item disabled={busy || saving} className="task-action-item" aria-label={`${task.name}查看记录`} onSelect={() => onOpenRecords(task.id)}><History size={16} />查看记录</DropdownMenu.Item>}
                  <DropdownMenu.Item className="task-action-item" onSelect={() => setDescriptionOpen(open => !open)} aria-controls={descriptionId} aria-expanded={descriptionOpen}><FileText size={16} />{`${descriptionOpen ? '收起' : '查看'}${detailsLabel}`}</DropdownMenu.Item>
                  <DropdownMenu.Separator className="task-action-separator" />
                  <DropdownMenu.Item disabled={busy || saving} className="task-action-item" aria-label={`归档${task.name}`} onSelect={() => void archive()}><Archive size={16} />归档任务</DropdownMenu.Item>
                  <DropdownMenu.Item disabled={busy} className="task-action-item task-action-delete" aria-label={`删除${task.name}`} onSelect={() => void remove()}><Trash2 size={16} />删除任务</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>

        {isCourse ? <div className="compact-course-progress">
          <div className="compact-course-meter">
            <TaskProgress label="学习进度" ariaLabel={`${task.name}课程进度`} value={task.progress} maximum={task.target} unit="节" met={task.is_done} effect={progressEffect} texture="honeycomb" />
          </div>
          {focusAction && !task.is_done && <button type="button" className="compact-history-button" disabled={busy} aria-label={`${task.name}开始专注`} title="开始专注" onClick={() => onStartFocus(task.id)}><Timer size={17} /></button>}
          <button type="button" className="compact-course-open" data-course-trigger={task.id} aria-label={`${task.name}${task.is_done ? '查看课程' : '继续学习'}`} onClick={() => onOpenCourse(task.id)}>{task.is_done ? '查看课程' : '继续学习'}<ArrowRight size={16} /></button>
        </div> : <div className={`compact-quick-progress ${task.is_done ? 'is-readonly' : ''}`}>
          <div className="compact-course-meter">
            <TaskProgress label={meterCaption} ariaLabel={`${task.name}${useDailyMeter ? '今日' : '总'}进度`} value={meterCurrent} displayValue={useDailyMeter ? todayAmount : meterCurrent} maximum={meterMaximum} unit={isDaily && !isPlan && !useDailyMeter ? '天' : task.unit} minimum={useDailyMeter ? dailyMinimum : 0} met={!task.plan_expired && (useDailyMeter ? task.daily_done : task.is_done)} pending={saving} failed={feedback?.phase === 'failed'} effect={progressEffect} daily={useDailyMeter} texture={isDaily || isPlan ? 'leaf' : 'woven'} />
          </div>
          <div className="compact-quick-actions">
            {!task.is_done && <div className="compact-stepper" role="group" aria-label={`${task.name}调整进度`}>
            {[-1, 1, 5].map(amount => {
              const retry = feedback?.phase === 'failed' && feedback.amount === amount;
              const allowed = amount < 0 ? canDecrement : canRecord;
              return <button key={amount} type="button" className={`compact-quick-button ${amount < 0 ? 'is-decrement' : ''} ${retry ? 'is-retry' : ''}`} disabled={busy || saving || (!allowed && !retry)} aria-label={`${task.name}${amount < 0 ? '减少' : '增加'}${Math.abs(amount)}${task.unit}`} title={retry ? `重试确认 ${amount} ${task.unit}` : amount < 0 ? `修正最近记录，减少 1 ${task.unit}` : `记录 ${amount} ${task.unit}`} onClick={() => void record(amount)}><span aria-hidden="true" className="compact-step-sign">{amount > 0 ? '+' : '−'}</span><span aria-hidden="true">{Math.abs(amount)}</span></button>;
            })}
            </div>}
            {task.is_done && feedback?.phase === 'failed' && <button type="button" className="compact-history-button with-label" disabled={busy || saving} aria-label={`${task.name}重试确认`} onClick={() => void record(feedback.amount)}>重试确认</button>}
            {focusAction && !task.is_done && <button type="button" className="compact-history-button" disabled={busy || saving} aria-label={`${task.name}开始专注`} title="开始专注" onClick={() => onStartFocus(task.id)}><Timer size={17} /></button>}
            {(!focusAction || task.is_done) && <button type="button" className="compact-history-button" disabled={busy || saving} data-record-trigger={task.id} aria-label={`${task.name}查看记录`} title={task.is_done ? '查看或修正记录' : '查看记录或填写其他完成量'} onClick={() => onOpenRecords(task.id)}><History size={17} /></button>}
          </div>
        </div>}

        {descriptionOpen && <div id={descriptionId} className="compact-task-description">
          <dl className="compact-task-facts">
            <div><dt>任务总量</dt><dd>{task.target} {totalUnit}</dd></div>
            <div><dt>累计完成</dt><dd>{task.progress} {totalUnit}</dd></div>
            {(!isCourse || dailyGoal > 0) && <><div><dt>每日目标量</dt><dd>{dailyGoal > 0 ? `${dailyGoal} ${task.unit}` : '未设置'}</dd></div><div><dt>最小完成量</dt><dd>{dailyMinimum > 0 ? `${dailyMinimum} ${task.unit}` : restDay ? '休息日' : '未设置'}</dd></div></>}
            <div><dt>执行周期</dt><dd>{frequencyLabel}</dd></div><div><dt>今日完成</dt><dd>{todayAmount} {isCourse ? '节' : task.unit}</dd></div><div><dt>优先级</dt><dd>{priority}</dd></div>
            <div><dt>创建日期</dt><dd><time dateTime={task.created_at}>{new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(task.created_at))}</time></dd></div>
            {task.deadline && <div><dt>截止日期</dt><dd><time dateTime={task.deadline}>{task.deadline.replaceAll('-', '/')}</time></dd></div>}
            {task.pending_schedule && <div><dt>{task.pending_schedule_date} 起</dt><dd>{scheduleLabel(task.pending_schedule)}</dd></div>}
          </dl>
          {task.description && <p>{task.description}</p>}{reward && <p className="compact-task-reward-detail"><Gift size={15} aria-hidden="true" /><span>关联奖励：{reward.name}</span></p>}
          <button type="button" onClick={() => setDescriptionOpen(false)}>{`收起${detailsLabel}`}</button>
        </div>}
        <CategoryAssignment task={task} open={categoryOpen} onClose={() => setCategoryOpen(false)} />
      </motion.article>
    </div>
  );
}
