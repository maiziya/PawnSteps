'use client';

import { useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Archive, BookOpen, ChevronLeft, ChevronRight, History, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { ownerIdentity } from '@/lib/api';
import type { Task } from '@/lib/types';
import './archive-panel.css';

export function ArchivePanel({ query, onOpenRecords, onOpenCourse, onRestored }: {
  query: string;
  onOpenRecords: (id: string) => void;
  onOpenCourse: (id: string) => void;
  onRestored: (task: Task) => void;
}) {
  const { archivedTasks, busy, mutate, timezone } = useAppStore();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);
  useEffect(() => {
    const media = matchMedia('(max-width: 767px)');
    const update = () => { setPageSize(media.matches ? 2 : 6); setPage(0); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { setPage(0); }, [query]);
  const matching = archivedTasks.filter(task => task.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const current = Math.min(page, pages - 1);
  const rows = matching.slice(current * pageSize, (current + 1) * pageSize);

  async function restore(task: Task) {
    const owner = ownerIdentity();
    try {
      await mutate(`/tasks/${task.id}/restore`, undefined, 'POST', { feedback: false, expectedOwner: owner });
      toast('任务已恢复，原有进度保留', { action: { label: '查看任务', onClick: () => {
        if (owner === ownerIdentity()) onRestored(task);
      } } });
    } catch { /* Store displays the error. */ }
  }

  async function remove(task: Task) {
    try { await mutate(`/tasks/${task.id}`, undefined, 'DELETE', { feedback: false, expectedOwner: ownerIdentity() }); }
    catch { /* Store offers a five-second undo after a successful delete. */ }
  }

  return <section className="archive-panel" aria-label="归档任务列表">
    <div className="archive-caption"><span><Archive size={16} />暂时收起，积累仍在</span><p>后续打卡已暂停，恢复后可继续。</p></div>
    {rows.length ? <div className="archive-list">{rows.map(task => {
      const unit = task.course_items !== null ? '节' : task.daily_quota > 0 && task.daily_plan === null ? '天' : task.unit;
      const archivedDate = new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(task.archived_at!));
      return <article key={task.id} className="archive-row" aria-label={`归档任务 ${task.name}`}>
        <div className="archive-row-content">
          <h3 title={task.name}>{task.name}</h3>
          <div className="archive-row-meta"><span className={task.is_done ? 'archive-complete' : ''}>{task.is_done ? '已完成' : '已暂停'}</span><span><time dateTime={task.archived_at!}>{archivedDate}</time> 归档</span></div>
          <div className="archive-progress"><div role="progressbar" aria-label={`${task.name}归档进度`} aria-valuemin={0} aria-valuemax={task.target} aria-valuenow={task.progress}><span style={{ width: `${Math.min(100, task.target ? task.progress / task.target * 100 : 0)}%` }} /></div><span>{task.progress} / {task.target} {unit}</span></div>
        </div>
        <div className="archive-row-actions">
          <button type="button" className="archive-restore" disabled={busy} aria-label={`恢复${task.name}`} onClick={() => void restore(task)}><RotateCcw size={14} /><span>恢复</span></button>
          <button type="button" className="icon-button" data-record-trigger={task.id} data-course-trigger={task.course_items !== null ? task.id : undefined} aria-label={`${task.name}${task.course_items !== null ? '查看课程' : '查看记录'}`} title={task.course_items !== null ? '查看课程' : '查看记录'} onClick={() => task.course_items !== null ? onOpenCourse(task.id) : onOpenRecords(task.id)}>{task.course_items !== null ? <BookOpen size={17} /> : <History size={17} />}</button>
          <DropdownMenu.Root><DropdownMenu.Trigger className="icon-button" aria-label={`${task.name}归档操作`} disabled={busy}><MoreHorizontal size={18} /></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="task-action-menu" align="end" sideOffset={6}><DropdownMenu.Item className="task-action-item task-action-delete" disabled={busy} aria-label={`删除归档${task.name}`} onSelect={() => void remove(task)}><Trash2 size={16} />删除任务</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
        </div>
      </article>;
    })}</div> : <div className="archive-empty"><Archive size={26} /><h3>{query.trim() ? '没有匹配的归档任务' : '还没有归档任务'}</h3><p>{query.trim() ? '试试其他关键词。' : '在任务的更多菜单中选择“归档任务”。'}</p></div>}
    {pages > 1 && <nav className="archive-pagination" aria-label="归档分页"><span>{matching.length} 项任务</span><button type="button" className="icon-button" aria-label="上一页归档" disabled={current === 0 || busy} onClick={() => setPage(current - 1)}><ChevronLeft size={17} /></button><span aria-live="polite">{current + 1} / {pages}</span><button type="button" className="icon-button" aria-label="下一页归档" disabled={current === pages - 1 || busy} onClick={() => setPage(current + 1)}><ChevronRight size={17} /></button></nav>}
  </section>;
}
