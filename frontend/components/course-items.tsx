'use client';

import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Check, ChevronDown, Folder, SquareCheck } from 'lucide-react';
import type { Task } from '@/lib/types';
import { groupCourseItems } from '@/lib/course';
import { useAppStore } from '@/lib/store';

interface SelectionRect { left: number; top: number; width: number; height: number }

export function CourseItems({ task }: { task: Task }) {
  const items = task.course_items || [];
  const groups = useMemo(() => groupCourseItems(items), [items]);
  const firstIncomplete = groups.find(group => group.indices.some(index => !items[index].done))?.id || groups[0]?.id;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(firstIncomplete ? [firstIncomplete] : []));
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const selectedRef = useRef<Set<number>>(new Set());
  const mutate = useAppStore(state => state.mutate);
  const busy = useAppStore(state => state.busy);

  async function setItems(indices: number[], done: boolean) {
    if (!indices.length || busy) return;
    try { await mutate(`/tasks/${task.id}/course`, { indices, done }); } catch { /* Store displays the error. */ }
  }

  function beginSelection(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || busy || !window.matchMedia('(pointer: fine)').matches) return;
    const target = event.target as HTMLElement;
    if (target.closest('button,input,label,[data-course-item]')) return;
    start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveSelection(event: PointerEvent<HTMLDivElement>) {
    if (!start.current || !root.current) return;
    const distance = Math.abs(event.clientX - start.current.x) + Math.abs(event.clientY - start.current.y);
    if (distance < 5) return;
    const viewportRect = {
      left: Math.min(start.current.x, event.clientX),
      top: Math.min(start.current.y, event.clientY),
      right: Math.max(start.current.x, event.clientX),
      bottom: Math.max(start.current.y, event.clientY),
    };
    const bounds = root.current.getBoundingClientRect();
    setSelection({ left: viewportRect.left - bounds.left, top: viewportRect.top - bounds.top, width: viewportRect.right - viewportRect.left, height: viewportRect.bottom - viewportRect.top });
    const indices = new Set<number>();
    root.current.querySelectorAll<HTMLElement>('[data-course-item]').forEach(element => {
      const rect = element.getBoundingClientRect();
      if (rect.left < viewportRect.right && rect.right > viewportRect.left && rect.top < viewportRect.bottom && rect.bottom > viewportRect.top) {
        indices.add(Number(element.dataset.courseItem));
      }
    });
    selectedRef.current = indices;
    setSelected(indices);
  }

  function finishSelection(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    if (!start.current) return;
    start.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const indices = [...selectedRef.current];
    setSelection(null);
    setSelected(new Set());
    selectedRef.current = new Set();
    if (!cancelled && indices.length) void setItems(indices, indices.some(index => !items[index].done));
  }

  return (
    <div ref={root} className="course-items relative mt-5 select-none" onPointerDown={beginSelection} onPointerMove={moveSelection} onPointerUp={event => finishSelection(event)} onPointerCancel={event => finishSelection(event, true)}>
      <div className="mb-3 flex items-center justify-between gap-2 px-1 text-xs text-[var(--muted)]">
        <span className="flex items-center gap-1.5"><SquareCheck size={14} /> 按章节，慢慢完成</span>
        <span className="hidden md:inline">在空白处拖动可框选</span>
      </div>
      <div className="space-y-2">
        {groups.map(group => {
          const completed = group.indices.filter(index => items[index].done).length;
          const isOpen = expanded.has(group.id);
          return (
            <section key={group.id} className="overflow-hidden rounded-xl border border-[var(--border)]">
              <div className="flex items-center gap-1 bg-[var(--background)] px-2">
                <button type="button" aria-expanded={isOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-1 text-left text-sm font-medium" onClick={() => setExpanded(current => {
                  const next = new Set(current);
                  if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                  return next;
                })}>
                  <ChevronDown size={15} className={`shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  <Folder size={15} className="shrink-0 text-[var(--muted)]" />
                  <span className="truncate">{group.name}</span>
                  <span className="ml-auto shrink-0 pr-2 font-normal tabular-nums text-[var(--muted)]">{completed}/{group.indices.length}</span>
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => void setItems(group.indices, completed !== group.indices.length)} className="min-h-11 px-2 text-xs text-[var(--primary)] disabled:opacity-40" aria-label={`${completed === group.indices.length ? '取消完成' : '完成'}${group.name}全部条目`}>
                  {completed === group.indices.length ? '取消全选' : '全选'}
                </button>
              </div>
              {isOpen && <div className="grid grid-cols-1 gap-1 p-3 sm:grid-cols-2">
                {group.indices.map(index => (
                  <label key={index} data-course-item={index} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${selected.has(index) ? 'bg-[var(--accent)]/35 outline outline-1 outline-[var(--primary)]' : 'hover:bg-[var(--background)]'} ${items[index].done ? 'text-[var(--muted)]' : ''}`}>
                    <input type="checkbox" className="peer sr-only" checked={items[index].done} disabled={Boolean(busy)} onChange={event => void setItems([index], event.target.checked)} />
                    <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary)] peer-focus-visible:ring-offset-2 ${items[index].done ? 'border-[var(--success)] bg-[var(--success)] text-[var(--surface)]' : 'border-[var(--border)]'}`} aria-hidden="true">
                      {items[index].done && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className={`min-w-0 break-words ${items[index].done ? 'line-through decoration-[var(--muted)]/40' : ''}`}>{items[index].name}</span>
                  </label>
                ))}
              </div>}
            </section>
          );
        })}
      </div>
      {selection && <div aria-hidden="true" className="pointer-events-none absolute z-10 rounded border border-[var(--primary)] bg-[var(--primary)]/15" style={selection} />}
    </div>
  );
}
