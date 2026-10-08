'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BookOpen, CalendarDays, Check, FileText, Flag, FolderOpen, LoaderCircle, Sun, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseCourseDirectory, parseCourseText } from '@/lib/course';
import { useAppStore } from '@/lib/store';
import type { CourseItem, Task } from '@/lib/types';

const formSchema = z.object({
  name: z.string().trim().min(1, '给这个目标起个名字').max(100, '名称最多 100 个字'),
  description: z.string().max(200, '描述最多 200 个字'),
  target: z.string().refine(value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100, '请输入 1–100 的整数'),
  priority: z.enum(['high', 'medium', 'low']),
  rewardId: z.string(),
  dailyQuota: z.string().refine(value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 10000, '每日配额为 1–10000 的整数'),
  plan: z.string(),
  planStartDate: z.string(),
});

type FormValues = z.infer<typeof formSchema>;
type TaskKind = 'normal' | 'daily' | 'plan' | 'course';

const taskKinds = [
  { value: 'normal' as const, label: '目标任务', icon: Flag, description: '一步步完成目标' },
  { value: 'daily' as const, label: '每日打卡', icon: Sun, description: '让坚持成为习惯' },
  { value: 'plan' as const, label: '天数计划', icon: CalendarDays, description: '安排每天的节奏' },
  { value: 'course' as const, label: '课程学习', icon: BookOpen, description: '导入学习清单' },
];

function localDate(): string {
  const today = useAppStore.getState().today;
  if (today) return today;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`;
}

function defaultValues(task?: Task | null): FormValues {
  return {
    name: task?.name || '',
    description: task?.description || '',
    target: String(task && !task.daily_plan && !task.course_items ? task.target : 10),
    priority: task?.priority || 'medium',
    rewardId: task?.reward_id || '',
    dailyQuota: String(task?.daily_quota || 1),
    plan: task?.daily_plan?.join(', ') || '10, 10, 0, 10, -1, 10, 5',
    planStartDate: task?.plan_start_date || localDate(),
  };
}

export function TaskForm({ open, onOpenChange, task }: { open: boolean; onOpenChange: (open: boolean) => void; task?: Task | null }) {
  const [kind, setKind] = useState<TaskKind>('normal');
  const [courseItems, setCourseItems] = useState<CourseItem[]>([]);
  const [importName, setImportName] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const rewards = useAppStore(state => state.rewards);
  const busy = useAppStore(state => state.busy);
  const mutate = useAppStore(state => state.mutate);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: defaultValues(task) });

  useEffect(() => {
    if (!open) return;
    reset(defaultValues(task));
    setKind(task?.course_items ? 'course' : task?.daily_plan ? 'plan' : task && task.daily_quota > 0 ? 'daily' : 'normal');
    setCourseItems(task?.course_items || []);
    setImportName('');
    setImportError('');
  }, [open, task, reset]);

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
      setCourseItems(items);
      setImportName(file.name);
    } catch (error) { setImportError(error instanceof Error ? error.message : '文件读取失败，请重试'); }
    finally { setImporting(false); }
  }

  function importDirectory(files: FileList | null) {
    if (!files?.length) return;
    const items = parseCourseDirectory(files);
    if (!items.some(item => !item.name.endsWith('/'))) { setImportError('这个文件夹没有可导入的文件'); return; }
    if (items.length > 10000 || items.some(item => item.name.length > 500)) { setImportError('最多 10000 个条目，单个条目名称最多 500 个字'); return; }
    setCourseItems(items);
    setImportName(files[0].webkitRelativePath.split('/')[0] || '已选文件夹');
    setImportError('');
  }

  async function submit(values: FormValues) {
    const payload: Record<string, unknown> = {
      name: values.name,
      description: values.description,
      priority: values.priority,
      reward_id: values.rewardId || null,
    };
    if (kind === 'normal' || kind === 'daily') payload.target = Number(values.target);
    if (kind === 'daily') payload.daily_quota = Number(values.dailyQuota);
    if (!task && kind === 'plan') {
      let plan: unknown;
      try { plan = values.plan.trim().startsWith('[') ? JSON.parse(values.plan) : values.plan.split(/[,，\s]+/).filter(Boolean).map(Number); }
      catch { setError('plan', { message: '请输入逗号分隔的每日配额，例如 10, 10, 0, 5' }); return; }
      if (!Array.isArray(plan) || !plan.length || plan.length > 730 || plan.some(value => !Number.isInteger(value) || value < -1 || value > 10000) || plan.reduce((sum: number, value: number) => sum + Math.max(0, value), 0) > 1000000) {
        setError('plan', { message: '计划需要 1–730 天，每天为 -1 到 10000 的整数，总步数不超过 100 万' }); return;
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

  return (
    <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{task ? '调整你的目标' : '从一个小目标开始'}</DialogTitle>
          <DialogDescription>{task ? '把节奏调整到适合自己的速度。' : '不用一步到位，今天比昨天多走一步。'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="mt-3 space-y-5">
          {!task && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="任务类型">
            {taskKinds.map(item => <button key={item.value} type="button" aria-pressed={kind === item.value} onClick={() => setKind(item.value)} className={`flex min-h-[84px] flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${kind === item.value ? 'border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--background)]'}`}>
              <item.icon size={18} className="mb-1" /><span className="text-sm font-medium">{item.label}</span><span className="text-xs text-[var(--muted)]">{item.description}</span>
            </button>)}
          </div>}

          <div className="space-y-1.5">
            <label htmlFor="task-name" className="text-sm font-medium">任务名称</label>
            <Input id="task-name" autoFocus placeholder={kind === 'daily' ? '每天读几页书' : kind === 'course' ? '完成一门想学的课程' : '你想向什么目标迈进一步？'} maxLength={100} aria-invalid={Boolean(errors.name)} {...register('name')} />
            {errors.name && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="task-description" className="text-sm font-medium">补充说明 <span className="font-normal text-[var(--muted)]">可选</span></label>
            <textarea id="task-description" className="field min-h-20 w-full resize-y" placeholder="写下你开始这件事的原因" maxLength={200} {...register('description')} />
            {errors.description && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.description.message}</p>}
          </div>

          {(kind === 'normal' || kind === 'daily') && <div className={`grid gap-4 ${kind === 'daily' ? 'sm:grid-cols-2' : ''}`}>
            <div className="space-y-1.5"><label htmlFor="task-target" className="text-sm font-medium">{kind === 'daily' ? '坚持天数' : '目标步数'} <span className="font-normal text-[var(--muted)]">1–100</span></label><Input id="task-target" type="number" min={1} max={100} {...register('target')} />{errors.target && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.target.message}</p>}</div>
            {kind === 'daily' && <div className="space-y-1.5"><label htmlFor="task-quota" className="text-sm font-medium">每日配额</label><Input id="task-quota" type="number" min={1} max={10000} {...register('dailyQuota')} />{errors.dailyQuota && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.dailyQuota.message}</p>}</div>}
          </div>}

          {kind === 'plan' && (task ? <div className="rounded-xl bg-[var(--background)] p-4 text-sm text-[var(--muted)]"><CalendarDays size={16} className="mb-2" />从 {task.plan_start_date} 开始，共 {task.daily_plan?.length} 天，{task.target} 步。</div> : <div className="space-y-4 rounded-xl bg-[var(--background)] p-4">
            <div className="space-y-1.5"><label htmlFor="task-plan-start" className="text-sm font-medium">开始日期</label><Input id="task-plan-start" type="date" {...register('planStartDate')} />{errors.planStartDate && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.planStartDate.message}</p>}</div>
            <div className="space-y-1.5"><label htmlFor="task-plan" className="text-sm font-medium">每天的配额</label><textarea id="task-plan" className="field min-h-20 w-full font-mono text-sm" {...register('plan')} /><p className="text-xs leading-relaxed text-[var(--muted)]">用逗号分隔每天的步数。0 或 -1 是休息日，会自动完成当天打卡。</p>{errors.plan && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors.plan.message}</p>}</div>
          </div>)}

          {kind === 'course' && (task ? <p className="rounded-xl bg-[var(--background)] p-4 text-sm text-[var(--muted)]">已导入 {courseCount} 节课程，完成 {task.progress} 节。在任务卡片中勾选学习进度。</p> : <div className="space-y-3 rounded-xl border border-dashed border-[var(--border)] p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Upload size={17} /> 导入课程内容</div>
            <p className="text-xs leading-relaxed text-[var(--muted)]">文本使用 ### 子标题分组，- 条目或 * 条目创建课程。也可以选择文件夹，以文件名生成清单。</p>
            <input ref={fileInput} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={event => { void importText(event.target.files?.[0]); event.target.value = ''; }} />
            <input ref={directoryInput} type="file" multiple {...directoryAttributes} className="hidden" onChange={event => { importDirectory(event.target.files); event.target.value = ''; }} />
            <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={pending}><FileText size={15} />选择 TXT / MD</Button><Button type="button" variant="outline" size="sm" onClick={() => directoryInput.current?.click()} disabled={pending}><FolderOpen size={15} />选择文件夹</Button></div>
            {courseCount > 0 && <div className="flex items-center gap-2 text-sm text-[var(--success)]"><Check size={16} /><span className="min-w-0 break-words">{importName} · {courseCount} 节课程</span></div>}
            {importError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{importError}</p>}
            <p className="text-xs text-[var(--muted)]">文件夹仅读取文件名，课程文件内容不会上传。</p>
          </div>)}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><label htmlFor="task-priority" className="text-sm font-medium">优先级</label><select id="task-priority" className="field w-full" {...register('priority')}><option value="high">高 · 优先投入</option><option value="medium">中 · 稳步推进</option><option value="low">低 · 从容安排</option></select></div>
            <div className="space-y-1.5"><label htmlFor="task-reward" className="text-sm font-medium">完成后的奖励</label><select id="task-reward" className="field w-full" {...register('rewardId')}><option value="">暂不关联奖励</option>{rewards.filter(reward => reward.streak_target === null).map(reward => <option key={reward.id} value={reward.id}>{reward.name}{reward.is_unlocked ? '（已解锁）' : ''}</option>)}</select></div>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4"><Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={pending}>{pending && <LoaderCircle size={16} className="animate-spin" />}{task ? '保存调整' : '创建任务'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
