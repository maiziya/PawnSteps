'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Folder, SquareCheck } from 'lucide-react';
import type { CourseItem, Task } from '@/lib/types';
import { displayCourseItemName, groupCourseItems } from '@/lib/course';
import { useAppStore } from '@/lib/store';
import './course-items.css';

interface SelectionRect { left: number; top: number; width: number; height: number }
interface Gesture {
  pointerId: number;
  originX: number;
  originY: number;
  clientX: number;
  clientY: number;
  downX: number;
  downY: number;
  dragging: boolean;
  clear: boolean;
  dirty: boolean;
}

interface PendingUpdate { id: number; indices: number[]; done: boolean }

function projectItems(source: CourseItem[], updates: PendingUpdate[]): CourseItem[] {
  const changes = new Map<number, boolean>();
  for (const update of updates) for (const index of update.indices) changes.set(index, update.done);
  return source.map((item, index) => changes.has(index) ? { ...item, done: changes.get(index)! } : item);
}

export function CourseItems({ task, onSelectionChange, readonlyIndices = [] }: { task: Task; onSelectionChange?: (indices: number[], done: boolean) => void; readonlyIndices?: number[] }) {
  const selectionCallback = useRef(onSelectionChange);
  selectionCallback.current = onSelectionChange;
  const readonlyRef = useRef(new Set(readonlyIndices));
  readonlyRef.current = new Set(readonlyIndices);
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdate[]>([]);
  const pendingRef = useRef<PendingUpdate[]>([]);
  const updateId = useRef(0);
  const mounted = useRef(true);
  const items = useMemo(() => projectItems(task.course_items || [], pendingUpdates), [task.course_items, pendingUpdates]);
  const groups = useMemo(() => groupCourseItems(items), [items]);
  const firstIncomplete = groups.find(group => group.indices.some(index => !items[index].done))?.id || groups[0]?.id;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(firstIncomplete ? [firstIncomplete] : []));
  const nextIndex = items.findIndex(item => !item.name.endsWith('/') && !item.done);
  const [navigation, setNavigation] = useState<{ index: number; focus: boolean } | null>(() => nextIndex < 0 ? null : { index: nextIndex, focus: false });
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [forceClear, setForceClear] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const selectedRef = useRef<Set<number>>(new Set());
  const frame = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const stopTracking = useRef<(() => void) | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const mutate = useAppStore(state => state.mutate);

  useLayoutEffect(() => {
    if (!navigation || !root.current) return;
    const scroller = root.current.closest<HTMLElement>('.course-drawer-body');
    const item = root.current.querySelector<HTMLElement>(`[data-course-item="${navigation.index}"]`);
    if (!scroller || !item) return;
    const viewport = scroller.getBoundingClientRect();
    const bounds = item.getBoundingClientRect();
    if (bounds.top < viewport.top + 8 || bounds.bottom > viewport.bottom - 8) {
      scroller.scrollTop += bounds.top - viewport.top - Math.min(48, viewport.height / 4);
    }
    if (navigation.focus) item.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    setNavigation(null);
  }, [navigation, expanded]);

  function locateNext(focus: boolean) {
    const index = itemsRef.current.findIndex(item => !item.name.endsWith('/') && !item.done);
    if (index < 0) return;
    const group = groupCourseItems(itemsRef.current).find(item => item.indices.includes(index));
    if (!group) return;
    setExpanded(current => new Set([...current, group.id]));
    setNavigation({ index, focus });
  }

  async function setItems(indices: number[], done: boolean) {
    const eligible = [...new Set(indices)].filter(index => itemsRef.current[index] && !itemsRef.current[index].name.endsWith('/') && !readonlyRef.current.has(index));
    if (!eligible.some(index => itemsRef.current[index].done !== done)) return;
    if (!eligible.length) return;
    if (selectionCallback.current) {
      itemsRef.current = projectItems(itemsRef.current, [{ id: 0, indices: eligible, done }]);
      selectionCallback.current(eligible, done); return;
    }
    const update: PendingUpdate = { id: ++updateId.current, indices: eligible, done };
    pendingRef.current = [...pendingRef.current, update];
    // Publish intent before rendering or awaiting the network so the next gesture sees it.
    itemsRef.current = projectItems(itemsRef.current, [update]);
    setPendingUpdates(pendingRef.current);
    try { await mutate(`/tasks/${task.id}/course`, { indices: eligible, done }); }
    catch { /* The store reports failures; remove only this failed optimistic update. */ }
    finally {
      pendingRef.current = pendingRef.current.filter(item => item.id !== update.id);
      const confirmed = useAppStore.getState().tasks.find(item => item.id === task.id)?.course_items || [];
      itemsRef.current = projectItems(confirmed, pendingRef.current);
      if (mounted.current) setPendingUpdates(pendingRef.current);
    }
  }

  function updateSelection() {
    const active = gesture.current;
    const element = root.current;
    if (!active?.dragging || !element) return;
    const bounds = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, active.clientX - bounds.left));
    const y = Math.max(0, Math.min(bounds.height, active.clientY - bounds.top));
    const rect = {
      left: Math.min(active.originX, x), top: Math.min(active.originY, y),
      width: Math.abs(x - active.originX), height: Math.abs(y - active.originY),
    };
    setSelection(previous => previous && previous.left === rect.left && previous.top === rect.top && previous.width === rect.width && previous.height === rect.height ? previous : rect);
    const indices = new Set<number>();
    element.querySelectorAll<HTMLElement>('[data-course-item]').forEach(item => {
      const itemBounds = item.getBoundingClientRect();
      if (itemBounds.left < bounds.left + rect.left + rect.width && itemBounds.right > bounds.left + rect.left && itemBounds.top < bounds.top + rect.top + rect.height && itemBounds.bottom > bounds.top + rect.top) {
        const index = Number(item.dataset.courseItem);
        if (!readonlyRef.current.has(index)) indices.add(index);
      }
    });
    if (indices.size !== selectedRef.current.size || [...indices].some(index => !selectedRef.current.has(index))) {
      selectedRef.current = indices;
      setSelected(indices);
    }
    setForceClear(active.clear);
  }

  function selectionFrame() {
    const active = gesture.current;
    if (!active?.dragging || !root.current) { frame.current = null; return; }
    const scroller = root.current.closest<HTMLElement>('.course-drawer-body');
    let scrolled = false;
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      const edge = Math.min(40, bounds.height / 4);
      let delta = 0;
      if (active.clientY < bounds.top + edge) delta = -Math.min(18, Math.max(1, (bounds.top + edge - active.clientY) / 2));
      else if (active.clientY > bounds.bottom - edge) delta = Math.min(18, Math.max(1, (active.clientY - bounds.bottom + edge) / 2));
      if (delta) {
        const previous = scroller.scrollTop;
        scroller.scrollTop += delta;
        scrolled = previous !== scroller.scrollTop;
      }
    }
    if (scrolled || active.dirty) { active.dirty = false; updateSelection(); }
    frame.current = requestAnimationFrame(selectionFrame);
  }

  function resetSelection(cancelClick = false) {
    const active = gesture.current;
    gesture.current = null;
    stopTracking.current?.();
    stopTracking.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (active && root.current?.hasPointerCapture(active.pointerId)) root.current.releasePointerCapture(active.pointerId);
    if (active?.dragging || cancelClick) suppressClick.current = true;
    selectedRef.current = new Set();
    setSelection(null);
    setSelected(new Set());
    setForceClear(false);
  }

  useEffect(() => {
    mounted.current = true;
    function keyboard(event: KeyboardEvent) {
      const active = gesture.current;
      if (!active) return;
      if (event.key === 'Escape' && event.type === 'keydown') {
        event.preventDefault(); event.stopPropagation(); resetSelection(true);
      } else if (event.key === 'Shift') {
        active.clear = event.type === 'keydown';
        active.dirty = true;
      }
    }
    const blur = () => { if (gesture.current) resetSelection(true); };
    const scroller = root.current?.closest<HTMLElement>('.course-drawer-body');
    const scroll = () => { if (gesture.current?.dragging) gesture.current.dirty = true; };
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('keyup', keyboard, true);
    window.addEventListener('blur', blur);
    scroller?.addEventListener('scroll', scroll, { passive: true });
    scroller?.addEventListener('pointerdown', beginSelection);
    return () => {
      mounted.current = false;
      window.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('keyup', keyboard, true);
      window.removeEventListener('blur', blur);
      scroller?.removeEventListener('scroll', scroll);
      scroller?.removeEventListener('pointerdown', beginSelection);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      gesture.current = null;
      stopTracking.current?.();
      stopTracking.current = null;
    };
  }, []);

  function beginSelection(event: globalThis.PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !window.matchMedia('(any-pointer: fine)').matches) return;
    suppressClick.current = false;
    const target = event.target as Element;
    const courseCheckbox = target.matches('input[type=checkbox]') && target.closest('[data-course-item]');
    if (!courseCheckbox && target.closest('button,input,a,select,textarea')) return;
    const scroller = root.current?.closest<HTMLElement>('.course-drawer-body');
    if (!root.current || !scroller) return;
    if (target === scroller && event.clientX >= scroller.getBoundingClientRect().left + scroller.clientWidth) return;
    const bounds = root.current.getBoundingClientRect();
    gesture.current = {
      pointerId: event.pointerId, originX: event.clientX - bounds.left, originY: event.clientY - bounds.top,
      downX: event.clientX, downY: event.clientY, clientX: event.clientX, clientY: event.clientY,
      dragging: false, clear: event.shiftKey, dirty: true,
    };
    // Track before crossing the drag threshold, including a first move outside the list.
    const finish = (pointer: globalThis.PointerEvent) => finishSelection(pointer);
    const cancel = (pointer: globalThis.PointerEvent) => finishSelection(pointer, true);
    // Capture can be transferred or released by the browser without cancelling the drag.
    // Only pointer-up, pointer-cancel, Escape, or window blur terminates this gesture.
    window.addEventListener('pointermove', moveSelection, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', cancel, true);
    stopTracking.current = () => {
      window.removeEventListener('pointermove', moveSelection, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', cancel, true);
    };
  }

  function moveSelection(event: globalThis.PointerEvent) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.clientX = event.clientX; active.clientY = event.clientY; active.clear = event.shiftKey; active.dirty = true;
    if (!active.dragging && Math.hypot(event.clientX - active.downX, event.clientY - active.downY) < 6) return;
    event.preventDefault();
    if (!active.dragging) {
      active.dragging = true;
      suppressClick.current = true;
      root.current?.setPointerCapture(event.pointerId);
      frame.current = requestAnimationFrame(selectionFrame);
    }
    updateSelection();
  }

  function finishSelection(event: globalThis.PointerEvent, cancelled = false) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!cancelled && Math.hypot(event.clientX - active.downX, event.clientY - active.downY) >= 6) active.dragging = true;
    if (active.dragging && !cancelled) {
      active.clientX = event.clientX; active.clientY = event.clientY; active.clear = event.shiftKey;
      updateSelection();
    }
    const indices = [...selectedRef.current];
    const done = !active.clear && indices.some(index => !itemsRef.current[index].done);
    const shouldCommit = active.dragging && !cancelled && indices.length > 0;
    resetSelection(cancelled);
    if (shouldCommit) void setItems(indices, done);
  }

  const selectionCompletes = !forceClear && [...selected].some(index => !items[index].done);
  return (
    <div ref={root} className="course-items relative mt-5 select-none" onClickCapture={event => {
      if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
    }}>
      <div className="course-selection-help">
        <span>{nextIndex >= 0 ? <button type="button" className="course-locate-next" aria-label="定位下一节" title={`下一节：${displayCourseItemName(items[nextIndex].name)}`} onClick={event => locateNext(event.detail === 0)}><ChevronDown size={14} />定位下一节</button> : <><SquareCheck size={14} />课程已完成</>}</span>
        <span className="course-mouse-hint">拖动框选 · Shift + 框选取消</span>
      </div>
      <p className="sr-only" aria-live="polite">{selection && selected.size ? `松开将${selectionCompletes ? '完成' : '取消完成'} ${selected.size} 项` : ''}</p>
      <div className="space-y-2">
        {groups.map(group => {
          const completed = group.indices.filter(index => items[index].done).length;
          const complete = completed === group.indices.length;
          const isOpen = expanded.has(group.id);
          return (
            <section key={group.id} className={`course-group overflow-hidden rounded-xl border border-[var(--border)] ${complete ? 'is-complete' : ''}`}>
              <div className="course-group-heading flex items-center gap-1 px-2">
                <button type="button" aria-expanded={isOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-1 text-left text-sm font-medium" onClick={() => setExpanded(current => {
                  const next = new Set(current);
                  if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                  return next;
                })}>
                  <ChevronDown size={15} className={`shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  {complete ? <Check size={15} aria-hidden="true" /> : <Folder size={15} className="shrink-0 text-[var(--muted)]" />}
                  <span className="truncate">{group.name}</span>
                  <span className="course-group-count ml-auto shrink-0 pr-2 font-normal tabular-nums">{completed}/{group.indices.length}</span>
                </button>
                <button type="button" disabled={group.indices.every(index => readonlyRef.current.has(index))} onClick={() => void setItems(group.indices, !complete)} className="min-h-11 px-2 text-xs text-[var(--primary)] disabled:opacity-40" aria-label={`${complete ? '取消完成' : '完成'}${group.name}全部条目`}>
                  {complete ? '取消全选' : '全选'}
                </button>
              </div>
              {isOpen && <div className="grid grid-cols-1 gap-1 p-3 sm:grid-cols-2">
                {group.indices.map(index => (
                  <label key={index} data-course-item={index} data-completed={items[index].done} className={`course-item flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm ${items[index].done ? 'is-complete' : ''} ${selected.has(index) ? `is-selected outline ${selectionCompletes ? 'will-complete' : 'will-clear'}` : ''}`}>
                    <input type="checkbox" disabled={readonlyRef.current.has(index)} className="peer sr-only" checked={items[index].done} onChange={event => void setItems([index], event.target.checked)} />
                    <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary)] peer-focus-visible:ring-offset-2 ${items[index].done ? 'border-[var(--success)] bg-[var(--success)] text-[var(--surface)]' : 'border-[var(--border)]'}`} aria-hidden="true">
                      {items[index].done && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 break-words">{displayCourseItemName(items[index].name)}</span>
                  </label>
                ))}
              </div>}
            </section>
          );
        })}
      </div>
      {selection && <div aria-hidden="true" className={`course-selection-box ${selectionCompletes ? 'will-complete' : 'will-clear'}`} style={selection} />}
    </div>
  );
}
