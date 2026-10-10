'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BookOpen, CalendarDays, Check, ChevronDown, FileText, Flag, FolderOpen, LoaderCircle, Sun } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseCourseDirectory, parseCourseText } from '@/lib/course';
import { useAppStore } from '@/lib/store';
import { everydaySchedule, ScheduleOptions, ScheduleSelect } from '@/components/schedule-fields';
import type { CourseItem, Task, TaskSchedule } from '@/lib/types';
import './task-form.css';

const formSchema = z.object({
  name: z.string().trim().min(1, '给这个目标起个名字').max(100, '名称最多 100 个字'),
  description: z.string().max(200, '描述最多 200 个字'),
  deadline: z.string().refine(value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), '请选择有效的截止日期'),
  target: z.string().refine(value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100, '请输入 1–100 的整数'),
  priority: z.enum(['high', 'medium', 'low']),
  rewardId: z.string(),
  dailyGoal: z.string().refine(value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 10000, '每日目标量为 1–10000 的整数'),
  dailyQuota: z.string().refine(value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 10000, '最小完成量为 1–10000 的整数'),
  plan: z.string(),
  planStartDate: z.string(),
  unit: z.string(),
  customUnit: z.string().trim().max(12, '计量单位最多 12 个字'),
});

type FormValues = z.infer<typeof formSchema>;
export type TaskKind = 'normal' | 'daily' | 'plan' | 'course';

const unitOptions = ['个', '次', '页', '题', '组', '步', '公里', '分钟', '小时', '节', '章', '篇', '天'];

const taskKinds = [
  { value: 'normal' as const, label: '目标任务', icon: Flag },
  { value: 'daily' as const, label: '每日打卡', icon: Sun },
  { value: 'plan' as const, label: '天数计划', icon: CalendarDays },
  { value: 'course' as const, label: '课程学习', icon: BookOpen },
];

function localDate(): string {
  const today = useAppStore.getState().today;
  if (today) return today;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`;
}

function defaultValues(task?: Task | null, kind: TaskKind = 'normal'): FormValues {
  return {
    name: task?.name || '',
    description: task?.description || '',
    deadline: task?.deadline || '',
    target: String(task && !task.daily_plan && !task.course_items ? task.target : 10),
    priority: task?.priority || 'medium',
    rewardId: task?.reward_id || '',
    dailyGoal: String(task?.daily_goal ?? (task?.daily_quota || task?.daily_minimum || (kind === 'course' ? Math.min(3, task?.target || 3) : 1))),
    dailyQuota: String(task?.daily_quota || task?.daily_minimum || 1),
    plan: task?.daily_plan?.join(', ') || '10, 10, 0, 10, -1, 10, 5',
    planStartDate: task?.plan_start_date || localDate(),
    unit: task?.unit && !unitOptions.includes(task.unit) ? 'custom' : task?.unit || '步',
    customUnit: task?.unit && !unitOptions.includes(task.unit) ? task.unit : '',
  };
}

export function TaskForm({ open, onOpenChange, task, initialKind = 'normal' }: { open: boolean; onOpenChange: (open: boolean) => void; task?: Task | null; initialKind?: TaskKind }) {
  const [kind, setKind] = useState<TaskKind>('normal');
  const [courseDaily, setCourseDaily] = useState(true);
  const [schedule, setSchedule] = useState<TaskSchedule>(everydaySchedule);
  const [deadlineInputVersion, setDeadlineInputVersion] = useState(0);
  const [courseItems, setCourseItems] = useState<CourseItem[]>([]);
  const [importName, setImportName] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const rewards = useAppStore(state => state.rewards);
  const busy = useAppStore(state => state.busy);
  const mutate = useAppStore(state => state.mutate);
  const { register, handleSubmit, reset, setError, clearErrors, watch, setValue, getValues, getFieldState, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: defaultValues(task) });
  const selectedUnit = watch('unit');
  const minimum = watch('dailyQuota');
  const deadline = watch('deadline');
  useEffect(() => {
    if (!getFieldState('dailyGoal').isDirty && Number(minimum) > Number(getValues('dailyGoal'))) {
      setValue('dailyGoal', minimum);
    }
  }, [minimum, getValues, getFieldState, setValue]);

  useEffect(() => {
    if (!open) return;
    const nextKind = task?.course_items ? 'course' : task?.daily_plan ? 'plan' : task && task.daily_quota > 0 ? 'daily' : task ? 'normal' : initialKind;
    reset(defaultValues(task, nextKind));
    setKind(nextKind);
    setCourseDaily(!task || task.daily_minimum > 0 || task.daily_goal !== null);
    setSchedule(task?.pending_schedule || task?.schedule || everydaySchedule());
    setCourseItems(task?.course_items || []);
    setImportName('');
    setImportError('');
  }, [open, task, reset, initialKind]);

  function updateCourseImport(items: CourseItem[], name: string) {
    setCourseItems(items);
    setImportName(name);
    if (!getFieldState('dailyGoal').isDirty) {
      const count = items.filter(item => !item.name.endsWith('/')).length;
      setValue('dailyGoal', String(Math.min(count, Math.max(3, Number(getValues('dailyQuota')) || 1))));
    }
  }

  async function importText(file?: File) {
    if (!file) return;
    setImporting(true);
    setImportError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('课程清单文件不能超过 2 MB');
      const items = parseCourseText(await file.text());
      if (!items.some(item => !item.name.endsWith('/'))) throw new Error('没有找到课程条目。请使用 - 条目 或 * 条目，每行一个。');
      if (items.length > 10000) throw new Error('最多导入 10000 个条目');
      if (items.some(item => item.name.length > 500)) throw new Error('单个条目名称不能超过 500 个字');
      updateCourseImport(items, file.name);
    } catch (error) { setImportError(error instanceof Error ? error.message : '文件读取失败，请重试'); }
    finally { setImporting(false); }
  }

  function importDirectory(files: FileList | null) {
    if (!files?.length) return;
    const items = parseCourseDirectory(files);
    if (!items.some(item => !item.name.endsWith('/'))) { setImportError('这个文件夹没有可导入的文件'); return; }
    if (items.length > 10000 || items.some(item => item.name.length > 500)) { setImportError('最多 10000 个条目，单个条目名称最多 500 个字'); return; }
    updateCourseImport(items, files[0].webkitRelativePath.split('/')[0] || '已选文件夹');
    setImportError('');
  }

  async function submit(values: FormValues) {
    const unit = kind === 'course' ? '节' : values.unit === 'custom' ? values.customUnit.trim() : values.unit;
    if (!unit) { setError('customUnit', { message: '请输入计量单位' }); return; }
    if ((kind === 'normal' || kind === 'daily' || (kind === 'course' && courseDaily)) && Number(values.dailyGoal) < Number(values.dailyQuota)) { setError('dailyGoal', { message: '每日目标量不能小于最小完成量' }); return; }
    if (kind === 'normal' && Number(values.dailyGoal) > Number(values.target)) { setError('dailyGoal', { message: '每日目标量不能超过任务总量' }); return; }
    if (kind === 'normal' && Number(values.dailyQuota) > Number(values.target)) { setError('dailyQuota', { message: '最小完成量不能超过目标任务总量' }); return; }
    if (kind === 'course') {
      if (!courseCount) { setImportError('请先导入一份课程清单或文件夹'); return; }
      if (courseDaily && Number(values.dailyQuota) > courseCount) { setError('dailyQuota', { message: '最小完成量不能超过课程节数' }); return; }
      if (courseDaily && Number(values.dailyGoal) > courseCount) { setError('dailyGoal', { message: '每日目标量不能超过课程节数' }); return; }
    }
    const appliedSchedule = kind === 'plan' || (kind === 'course' && !courseDaily) ? everydaySchedule() : schedule;
    if (appliedSchedule.mode === 'weekdays' && !appliedSchedule.weekdays.length) { setError('root.schedule', { message: '至少选择一天' }); return; }
    const payload: Record<string, unknown> = {
      schedule: appliedSchedule,
      name: values.name,
      description: values.description,
      deadline: values.deadline || null,
      priority: values.priority,
      reward_id: values.rewardId || null,
      unit,
    };
    if (kind === 'normal' || kind === 'daily') {
      payload.target = Number(values.target);
      payload.daily_goal = Number(values.dailyGoal);
    }
    if (kind === 'daily') payload.daily_quota = Number(values.dailyQuota);
    if (kind === 'normal') payload.daily_minimum = Number(values.dailyQuota);
    if (kind === 'course') {
      payload.daily_minimum = courseDaily ? Number(values.dailyQuota) : 0;
      payload.daily_goal = courseDaily ? Number(values.dailyGoal) : null;
    }
    if (!task && kind === 'plan') {
      let plan: unknown;
      try { plan = values.plan.trim().startsWith('[') ? JSON.parse(values.plan) : values.plan.split(/[,，\s]+/).filter(Boolean).map(Number); }
      catch { setError('plan', { message: '请输入逗号分隔的每日配额，例如 10, 10, 0, 5' }); return; }
      if (!Array.isArray(plan) || !plan.length || plan.length > 730 || plan.some(value => !Number.isInteger(value) || value < -1 || value > 10000) || plan.reduce((sum: number, value: number) => sum + Math.max(0, value), 0) > 1000000) {
        setError('plan', { message: '计划需要 1–730 天，每天为 -1 到 10000 的整数，总量不超过 100 万' }); return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(values.planStartDate)) { setError('planStartDate', { message: '请选择开始日期' }); return; }
      payload.daily_plan = plan;
      payload.plan_start_date = values.planStartDate;
    }
    if (!task && kind === 'course') {
      if (!courseItems.some(item => !item.name.endsWith('/'))) { setImportError('请先导入一份课程清单或文件夹'); return; }
      payload.course_items = courseItems;
    }
    try {
      await mutate(task ? `/tasks/${task.id}` : '/tasks', payload, task ? 'PATCH' : 'POST');
      onOpenChange(false);
    } catch { /* Store displays the API error without closing the form. */ }
  }

  const courseCount = courseItems.filter(item => !item.name.endsWith('/')).length;
  const pending = Boolean(busy) || isSubmitting || importing;
  const directoryAttributes = { webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>;

  function toggleCourseDaily(enabled: boolean) {
    setCourseDaily(enabled);
    if (enabled) return;
    clearErrors(['dailyQuota', 'dailyGoal']);
    clearErrors('root.schedule');
    for (const field of ['dailyQuota', 'dailyGoal'] as const) {
      const value = getValues(field);
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 10000) setValue(field, '1');
    }
  }

  const updateSchedule = (value: TaskSchedule) => { setSchedule(value); clearErrors('root.schedule'); };
  const additionalFields = <>
          <div className="space-y-1.5"><div className="task-deadline-label"><label htmlFor="task-deadline" className="text-sm font-medium">截止日期 <span className="font-normal text-[var(--muted)]">可选</span></label>{deadline && <button type="button" onClick={() => {
            setValue('deadline', '', { shouldDirty: true, shouldValidate: true });
            // Reset WebKit's native date editor, which can block submission after an imperative clear.
            setDeadlineInputVersion(version => version + 1);
          }}>清空截止日期</button>}</div><Input key={deadlineInputVersion} id="task-deadline" type="date" aria-label="截止日期" {...register('deadline')} />{errors.deadline && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.deadline.message}</p>}</div>
          <div className="task-settings-grid">
            <div className="space-y-1.5"><label htmlFor="task-priority" className="text-sm font-medium">优先级</label><select id="task-priority" className="field w-full" {...register('priority')}><option value="high">高 · 优先投入</option><option value="medium">中 · 稳步推进</option><option value="low">低 · 从容安排</option></select></div>
            <div className="space-y-1.5"><label htmlFor="task-reward" className="text-sm font-medium">完成后的奖励</label><select id="task-reward" className="field w-full" {...register('rewardId')}><option value="">暂不关联奖励</option>{rewards.filter(reward => reward.streak_target === null).map(reward => <option key={reward.id} value={reward.id}>{reward.name}{reward.is_unlocked ? '（已解锁）' : ''}</option>)}</select></div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="task-description" className="text-sm font-medium">补充说明 <span className="font-normal text-[var(--muted)]">可选</span></label>
            <textarea id="task-description" className="field task-description" rows={1} placeholder="添加备注（可选）" maxLength={200} {...register('description')} />
            {errors.description && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.description.message}</p>}
          </div>

  </>;

  return (
    <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="task-form-dialog">
        <DialogHeader>
          <DialogTitle>{task ? '调整你的目标' : '从一个小目标开始'}</DialogTitle>
          <DialogDescription className="sr-only">{task ? '把节奏调整到适合自己的速度。' : '不用一步到位，今天比昨天多走一步。'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="task-form-fields">
          {!task && <div className="task-kind-options" role="group" aria-label="任务类型">
            {taskKinds.map(item => <button key={item.value} type="button" aria-pressed={kind === item.value} onClick={() => { setKind(item.value); if (item.value === 'course' && !getFieldState('dailyGoal').isDirty) setValue('dailyGoal', String(Math.min(courseCount || 3, Math.max(3, Number(getValues('dailyQuota')) || 1)))); }} className={`task-kind-option ${kind === item.value ? 'is-selected' : ''}`}>
              <item.icon size={17} aria-hidden="true" /><span>{item.label}</span>
            </button>)}
          </div>}

          <div className="space-y-1.5">
            <label htmlFor="task-name" className="text-sm font-medium">任务名称</label>
            <Input id="task-name" autoFocus placeholder={kind === 'daily' ? '每天读几页书' : kind === 'course' ? '完成一门想学的课程' : '你想向什么目标迈进一步？'} maxLength={100} aria-invalid={Boolean(errors.name)} {...register('name')} />
            {errors.name && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.name.message}</p>}
          </div>

          {kind !== 'course' && <div className="task-settings-grid">
            {(kind === 'normal' || kind === 'daily') && <div className="space-y-1.5"><label htmlFor="task-target" className="text-sm font-medium">{kind === 'daily' ? '坚持天数' : '目标任务总量'} <span className="font-normal text-[var(--muted)]">1–100</span></label><Input id="task-target" type="number" min={1} max={100} {...register('target')} />{errors.target && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.target.message}</p>}</div>}
            <div className="space-y-1.5"><label htmlFor="task-unit" className="text-sm font-medium">计量单位</label><div className={selectedUnit === 'custom' ? 'task-custom-unit-row' : undefined}><select id="task-unit" className="field w-full" {...register('unit')}>{unitOptions.map(unit => <option key={unit} value={unit}>{unit}</option>)}<option value="custom">自定义</option></select>{selectedUnit === 'custom' && <><label htmlFor="task-custom-unit" className="sr-only">自定义单位</label><Input id="task-custom-unit" maxLength={12} placeholder="单位" {...register('customUnit')} /></>}</div>{selectedUnit === 'custom' && errors.customUnit && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.customUnit.message}</p>}</div>
            {(kind === 'daily' || kind === 'normal') && <div className="space-y-1.5"><label htmlFor="task-quota" className="text-sm font-medium">最小完成量</label><Input id="task-quota" type="number" min={1} max={10000} {...register('dailyQuota')} />{errors.dailyQuota && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.dailyQuota.message}</p>}</div>}
            {(kind === 'daily' || kind === 'normal') && <div className="space-y-1.5"><label htmlFor="task-daily-goal" className="text-sm font-medium">每日目标量</label><Input id="task-daily-goal" type="number" min={1} max={10000} {...register('dailyGoal')} />{errors.dailyGoal && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.dailyGoal.message}</p>}</div>}
            {kind === 'plan' && !task && <div className="space-y-1.5"><label htmlFor="task-plan-start" className="text-sm font-medium">开始日期</label><Input id="task-plan-start" type="date" {...register('planStartDate')} />{errors.planStartDate && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.planStartDate.message}</p>}</div>}
          </div>}

          {(kind === 'normal' || kind === 'daily') && <div className="task-schedule-fields"><ScheduleSelect value={schedule} onChange={updateSchedule} /><ScheduleOptions value={schedule} onChange={updateSchedule} />{task && <p className="schedule-note">执行频率调整从明天生效，历史记录保留。</p>}{errors.root?.schedule && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.root.schedule.message}</p>}</div>}

          {kind === 'plan' && (task ? <div className="rounded-xl bg-[var(--background)] p-4 text-sm text-[var(--muted)]"><CalendarDays size={16} className="mb-2" />从 {task.plan_start_date} 开始，共 {task.daily_plan?.length} 天，目标任务总量 {task.target} {task.unit}。</div> : <div>
            <div className="space-y-1.5"><label htmlFor="task-plan" className="text-sm font-medium">每天的配额</label><textarea id="task-plan" rows={1} className="field task-plan-input font-mono text-sm" {...register('plan')} /><p className="text-xs leading-relaxed text-[var(--muted)]">逗号分隔每日配额，0 或 -1 表示休息。</p>{errors.plan && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.plan.message}</p>}</div>
          </div>)}

          {kind === 'course' && (task ? <p className="rounded-xl bg-[var(--background)] p-4 text-sm text-[var(--muted)]">已导入 {courseCount} 节课程，完成 {task.progress} 节。打开课程后勾选学习进度。</p> : <div className="task-course-import">
            <input ref={fileInput} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={event => { void importText(event.target.files?.[0]); event.target.value = ''; }} />
            <input ref={directoryInput} type="file" multiple {...directoryAttributes} className="hidden" onChange={event => { importDirectory(event.target.files); event.target.value = ''; }} />
            <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" title="TXT / MD：用 ### 分组，- 或 * 列出课程" onClick={() => fileInput.current?.click()} disabled={pending}><FileText size={15} />选择 TXT / MD</Button><Button type="button" variant="outline" size="sm" title="仅读取文件名，不上传文件内容" onClick={() => directoryInput.current?.click()} disabled={pending}><FolderOpen size={15} />选择文件夹</Button></div>
            {courseCount > 0 && <div className="flex items-center gap-2 text-sm text-[var(--success)]"><Check size={16} /><span className="min-w-0 break-words">{importName} · {courseCount} 节课程</span></div>}
            {importError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{importError}</p>}
          </div>)}

          {kind === 'course' && <div className="task-course-daily">
            <div className="task-course-plan-heading"><label className="task-course-daily-toggle"><input type="checkbox" checked={courseDaily} onChange={event => toggleCourseDaily(event.target.checked)} />每日学习计划</label>{courseDaily && <ScheduleSelect compact value={schedule} onChange={updateSchedule} />}</div>{courseDaily && <ScheduleOptions value={schedule} onChange={updateSchedule} />}{task && courseDaily && <p className="schedule-note">执行频率调整从明天生效，历史记录保留。</p>}{errors.root?.schedule && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.root.schedule.message}</p>}
            {courseDaily && <div className="task-settings-grid">
              <div className="space-y-1.5"><label htmlFor="course-minimum">最小完成量<span className="muted" aria-hidden="true">（节）</span></label><Input id="course-minimum" aria-label="最小完成量" type="number" min={1} max={courseCount || 10000} {...register('dailyQuota')} />{errors.dailyQuota && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.dailyQuota.message}</p>}</div>
              <div className="space-y-1.5"><label htmlFor="course-goal">每日目标量<span className="muted" aria-hidden="true">（节）</span></label><Input id="course-goal" aria-label="每日目标量" type="number" min={1} max={courseCount || 10000} {...register('dailyGoal')} />{errors.dailyGoal && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.dailyGoal.message}</p>}</div>
            </div>}
          </div>}
          <details className="task-course-options"><summary>截止日期、优先级与备注<ChevronDown size={16} /></summary><div className="task-form-fields">{additionalFields}</div></details>
          <div className="task-form-footer"><Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={pending}>{pending && <LoaderCircle size={16} className="animate-spin" />}{task ? '保存调整' : '创建任务'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
