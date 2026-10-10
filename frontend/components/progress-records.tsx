'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { History, LoaderCircle, Pencil, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import type { MutationResponse, ProgressRecord, ProgressRecordsResponse } from '@/lib/types';
import './progress-records.css';

const PAGE_SIZE = 50;
const MAX_AMOUNT = 1000000;

function validAmount(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= MAX_AMOUNT;
}

function sortRecords(records: ProgressRecord[]): ProgressRecord[] {
  return records.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export function ProgressRecords({ taskId, onClose, returnFocus }: { taskId: string | null; onClose: () => void; returnFocus?: () => HTMLElement | null }) {
  const task = useAppStore(state => [...state.tasks, ...state.archivedTasks].find(item => item.id === taskId));
  const mutate = useAppStore(state => state.mutate);
  const busy = useAppStore(state => state.busy);
  const timezone = useAppStore(state => state.timezone);
  const [records, setRecords] = useState<ProgressRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [amount, setAmount] = useState('1');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('1');
  const [editNote, setEditNote] = useState('');
  const [editError, setEditError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const activeTaskId = useRef(taskId);
  const previousTaskId = useRef(taskId);
  const pendingAttempt = useRef<{ payload: string; id: string } | null>(null);
  activeTaskId.current = taskId;
  if (taskId) previousTaskId.current = taskId;

  useEffect(() => {
    setRecords([]);
    setTotal(0);
    setAmount('1');
    setNote('');
    setFormError('');
    setEditingId(null);
    setLoadError('');
    pendingAttempt.current = null;
    if (!taskId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    api<ProgressRecordsResponse>(`/tasks/${taskId}/records?offset=0&limit=${PAGE_SIZE}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setRecords(data.records); setTotal(data.total); } })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : '记录读取失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [taskId]);

  async function loadMore() {
    if (!taskId || loading) return;
    const requestedId = taskId;
    setLoading(true);
    setLoadError('');
    try {
      const data = await api<ProgressRecordsResponse>(`/tasks/${requestedId}/records?offset=${records.length}&limit=${PAGE_SIZE}`);
      if (activeTaskId.current !== requestedId) return;
      setRecords(previous => sortRecords([...new Map([...previous, ...data.records].map(record => [record.id, record])).values()]));
      setTotal(data.total);
    } catch (error) {
      if (activeTaskId.current === requestedId) setLoadError(error instanceof Error ? error.message : '记录读取失败');
    } finally { if (activeTaskId.current === requestedId) setLoading(false); }
  }

  function applyRecord(response: MutationResponse) {
    const record = response.record;
    if (!record || activeTaskId.current !== record.task_id) return;
    setRecords(previous => sortRecords([...previous.filter(item => item.id !== record.id), ...(record.deleted_at ? [] : [record])]));
    const currentTask = response.tasks.find(item => item.id === record.task_id);
    if (currentTask) setTotal(currentTask.record_count);
  }

  async function addRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task || !canRecord || pending) return;
    if (!validAmount(amount)) { setFormError('请输入 1–1000000 的整数'); return; }
    if (note.length > 200) { setFormError('备注最多 200 个字'); return; }
    const payload = { amount: Number(amount), note: note.trim() };
    const serialized = JSON.stringify(payload);
    if (pendingAttempt.current?.payload !== serialized) pendingAttempt.current = { payload: serialized, id: crypto.randomUUID() };
    setFormError('');
    setSubmitting(true);
    try {
      const response = await mutate(`/tasks/${task.id}/records`, { ...payload, request_id: pendingAttempt.current.id });
      applyRecord(response);
      pendingAttempt.current = null;
      setAmount('1');
      setNote('');
      toast.success('记录已保存');
    } catch (error) { setFormError(error instanceof Error ? error.message : '保存失败，请重试'); }
    finally { setSubmitting(false); }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task || task.archived_at || !editingId || pending) return;
    if (!validAmount(editAmount)) { setEditError('请输入 1–1000000 的整数'); return; }
    if (editNote.length > 200) { setEditError('备注最多 200 个字'); return; }
    setEditError('');
    setSubmitting(true);
    try {
      applyRecord(await mutate(`/tasks/${task.id}/records/${editingId}`, { amount: Number(editAmount), note: editNote.trim() }, 'PATCH'));
      setEditingId(null);
      toast.success('记录已修改');
    } catch (error) { setEditError(error instanceof Error ? error.message : '修改失败，请重试'); }
    finally { setSubmitting(false); }
  }

  async function revoke(record: ProgressRecord) {
    if (!task || task.archived_at || pending) return;
    setSubmitting(true);
    try {
      applyRecord(await mutate(`/tasks/${task.id}/records/${record.id}`, undefined, 'DELETE'));
      if (editingId === record.id) setEditingId(null);
      toast.success('记录已撤销');
    } catch { /* Store displays the API error. */ }
    finally { setSubmitting(false); }
  }

  const isPlan = task?.daily_plan !== null && task?.daily_plan !== undefined;
  const isDaily = Boolean(task && (task.daily_quota > 0 || isPlan));
  const canRecord = Boolean(task && !task.archived_at && !task.plan_expired && !(isPlan && task.daily_quota === 0) && (!task.is_done || (isDaily && task.daily_done)));
  const pending = busy || submitting || loading;
  const unit = task?.unit || '步';
  const status = task?.archived_at ? '任务已归档，记录只读；恢复任务后可以继续记录和调整。' : task?.plan_expired ? '计划已结束，可查看和调整已有记录。'
    : isPlan && task?.daily_quota === 0 ? (task?.daily_done ? '今天是休息日，无需记录。' : `计划从 ${task?.plan_start_date} 开始。`)
    : !canRecord ? '目标已完成，可查看和调整已有记录。'
    : task?.daily_done ? '今日已达标，仍可继续记录实际完成量。' : '每次记录一段实际完成量，进度会自动汇总。';

  return <Dialog open={Boolean(taskId && task)} onOpenChange={open => { if (!open && !busy && !submitting) onClose(); }}>
    <DialogContent className="progress-records-dialog" onCloseAutoFocus={event => {
      event.preventDefault();
      const id = previousTaskId.current;
      requestAnimationFrame(() => {
        const state = useAppStore.getState();
        if (state.unlocked) return;
        const completedToggle = document.querySelector<HTMLButtonElement>('.completed-toggle');
        const finished = state.tasks.find(item => item.id === id)?.is_done;
        const trigger = id ? document.querySelector<HTMLButtonElement>(`[data-record-trigger="${id}"]`) : null;
        const target = returnFocus?.() || (finished && completedToggle?.getAttribute('aria-expanded') === 'false' ? completedToggle : trigger || completedToggle);
        target?.focus({ preventScroll: true });
      });
    }}>
      <div className="progress-records-scroll">
        <DialogHeader>
          <DialogTitle>记录进度 · {task?.name}</DialogTitle>
          <DialogDescription>{status}</DialogDescription>
        </DialogHeader>
        {task && <>
          <div className="record-totals" aria-label="进度汇总">
            <span>{isDaily && !isPlan ? '累计达标' : '总进度'}<strong>{task.progress} / {task.target} <small>{isDaily && !isPlan ? '天' : unit}</small></strong></span>
            <span>今日完成<strong>{task.today_amount}{isDaily && task.daily_quota > 0 ? ` / ${task.daily_quota}` : ''} <small>{unit}</small></strong></span>
          </div>
          {canRecord && <form className="record-create-form" onSubmit={addRecord}>
            <div className="record-amount-row"><label htmlFor="record-amount">本次完成量<span className="record-input-unit"><Input id="record-amount" aria-label="本次完成量" type="number" inputMode="numeric" min={1} max={MAX_AMOUNT} step={1} value={amount} disabled={pending} aria-invalid={Boolean(formError)} onChange={event => { setAmount(event.target.value); pendingAttempt.current = null; }} /><span>{unit}</span></span></label><Button type="submit" disabled={pending}>{submitting && <LoaderCircle size={16} className="animate-spin" />}保存记录</Button></div>
            <label htmlFor="record-note">备注 <span className="record-optional">可选</span><Input id="record-note" aria-label="备注" placeholder="写下这次做了什么" value={note} maxLength={200} disabled={pending} onChange={event => { setNote(event.target.value); pendingAttempt.current = null; }} /></label>
            {formError && <p role="alert" className="record-error">{formError}</p>}
          </form>}
          <section className="record-history" aria-label="进度记录">
            <div className="record-history-heading"><h3><History size={17} />记录历史</h3><span>{total} 条记录</span></div>
            {records.length === 0 && !loading && !loadError && <p className="record-empty">还没有记录，完成后在这里留下一笔。</p>}
            <div className="record-list">{records.map(record => <article className="record-entry" key={record.id} aria-label={`进度记录 ${record.id}`}>
              <div className="record-entry-heading"><strong>{record.amount} <span>{unit}</span></strong><span className="record-date">{record.date === null ? '旧版累计 · 日期未知' : `${record.source === 'legacy' ? '旧版记录 · ' : ''}${record.date}${record.source === 'manual' ? ` ${new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(record.created_at))}` : ''}`}</span></div>
              {editingId === record.id && !task.archived_at ? <form className="record-edit-form" onSubmit={saveEdit}><label htmlFor={`edit-amount-${record.id}`}>修改完成量<Input id={`edit-amount-${record.id}`} type="number" min={1} max={MAX_AMOUNT} step={1} value={editAmount} disabled={pending} onChange={event => setEditAmount(event.target.value)} /></label><label htmlFor={`edit-note-${record.id}`}>修改备注<Input id={`edit-note-${record.id}`} value={editNote} maxLength={200} disabled={pending} onChange={event => setEditNote(event.target.value)} /></label>{editError && <p role="alert" className="record-error">{editError}</p>}<div className="record-edit-actions"><Button type="button" variant="ghost" disabled={pending} onClick={() => setEditingId(null)}>取消编辑</Button><Button type="submit" disabled={pending}>保存修改</Button></div></form> : <>
                {record.note && <p className="record-note">{record.note}</p>}
                {!task.archived_at && <div className="record-entry-actions"><button type="button" disabled={pending} onClick={() => { setEditingId(record.id); setEditAmount(String(record.amount)); setEditNote(record.note); setEditError(''); }}><Pencil size={14} />编辑记录</button><button type="button" disabled={pending} onClick={() => void revoke(record)}><RotateCcw size={14} />撤销记录</button></div>}
              </>}
            </article>)}</div>
            {loading && <p className="record-loading" role="status"><LoaderCircle size={16} className="animate-spin" />正在读取记录</p>}
            {loadError && <div className="record-load-error"><p role="alert">{loadError}</p><Button variant="outline" onClick={() => void loadMore()} disabled={pending}>重新加载</Button></div>}
            {!loading && !loadError && records.length < total && <Button className="record-load-more" type="button" variant="outline" disabled={pending} onClick={() => void loadMore()}>加载更多记录</Button>}
          </section>
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
