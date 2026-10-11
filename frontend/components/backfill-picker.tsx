'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Flag, Search } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { canRecordOn } from '@/lib/record-dates';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function BackfillPicker({ date, onClose, onSelect }: { date: string | null; onClose: () => void; onSelect: (taskId: string, date: string) => void }) {
  const { tasks, today, timezone, busy } = useAppStore();
  const [query, setQuery] = useState('');
  useEffect(() => { setQuery(''); }, [date]);
  const eligible = tasks.filter(task => date && canRecordOn(task, date, today, timezone) && (!task.course_items || !task.is_done) && task.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Dialog open={Boolean(date)} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="backfill-picker" aria-labelledby="backfill-picker-title" onOpenAutoFocus={event => {
    event.preventDefault();
    requestAnimationFrame(() => document.getElementById('backfill-picker-title')?.focus({ preventScroll: true }));
  }}><DialogHeader><DialogTitle id="backfill-picker-title" tabIndex={-1}>补记任务</DialogTitle><DialogDescription>选择任务，记录 {date} 的实际完成量。</DialogDescription></DialogHeader><div className="backfill-search"><Search size={16} /><Input aria-label="搜索补记任务" placeholder="搜索任务" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="backfill-task-options">{eligible.map(task => <button key={task.id} type="button" disabled={busy} aria-label={`补记${task.name}`} onClick={() => { if (date) onSelect(task.id, date); }}>{task.course_items ? <BookOpen size={18} /> : <Flag size={18} />}<span><strong>{task.name}</strong><small>{task.course_items ? '按已学习的课程勾选' : `记录完成量 · ${task.unit}`}</small></span><ArrowRight size={16} /></button>)}{!eligible.length && <p className="backfill-empty">这一天没有可补记的任务。请选择任务开始之后的有效日期，或更换搜索词。</p>}</div></DialogContent></Dialog>;
}
