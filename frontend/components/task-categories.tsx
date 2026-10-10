'use client';

import { useEffect, useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ArrowDown, ArrowUp, Check, ChevronDown, Folder, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { ownerIdentity } from '@/lib/api';
import type { CategoryColor, Task, TaskCategory } from '@/lib/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import './task-categories.css';

export const categoryColors: { value: CategoryColor; name: string }[] = [
  { value: 'clay', name: '陶土红' }, { value: 'sage', name: '鼠尾草绿' },
  { value: 'ochre', name: '麦穗黄' }, { value: 'slate', name: '雾蓝' },
  { value: 'rose', name: '玫瑰粉' }, { value: 'lavender', name: '灰紫' },
];

export function matchesCategory(task: Task, selected: string): boolean {
  return selected === 'all' || (selected === 'uncategorized' ? !task.category_id : task.category_id === selected);
}

function CategoryDot({ color }: { color: CategoryColor }) {
  return <span className={`category-dot category-${color}`} aria-hidden="true" />;
}

export function CategoryBadge({ categoryId }: { categoryId?: string | null }) {
  const category = useAppStore(state => state.categories.find(row => row.id === categoryId));
  if (!category) return null;
  return <span className="task-category-badge" title={`分类：${category.name}`} aria-label={`分类：${category.name}`}><CategoryDot color={category.color} /><span>{category.name}</span></span>;
}

export function CategoryAssignment({ task, open, onClose }: { task: Task; open: boolean; onClose: () => void }) {
  const { categories, busy, mutate } = useAppStore();
  async function assign(id: string) {
    if (id === (task.category_id || '')) { onClose(); return; }
    try {
      await mutate(`/tasks/${task.id}/category`, { category_id: id || null }, 'PUT', { feedback: false, expectedOwner: ownerIdentity() });
      onClose();
    } catch { /* Keep the selection available for retry. */ }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent className="category-assignment" onCloseAutoFocus={event => {
    event.preventDefault();
    requestAnimationFrame(() => (document.querySelector<HTMLButtonElement>(`[data-category-trigger="${task.id}"]`) || document.getElementById('main-content'))?.focus({ preventScroll: true }));
  }}><DialogHeader><DialogTitle>设置分类</DialogTitle><DialogDescription>{task.name}</DialogDescription></DialogHeader><div className="category-assignment-list">{[{ id: '', name: '未分类', color: null }, ...categories].map(row => <button type="button" className="category-assignment-row" aria-pressed={(task.category_id || '') === row.id} disabled={busy} key={row.id} onClick={() => void assign(row.id)}>{row.color ? <CategoryDot color={row.color} /> : <Folder size={15} />}<span>{row.name}</span>{(task.category_id || '') === row.id && <Check size={15} />}</button>)}</div></DialogContent></Dialog>;
}

export function CategoryFilter() {
  const { categories, selectedCategory, selectCategory } = useAppStore();
  const [manage, setManage] = useState(false);
  const category = categories.find(row => row.id === selectedCategory);
  return <><Menu.Root><Menu.Trigger asChild><button type="button" className="category-filter" title={category?.name || (selectedCategory === 'uncategorized' ? '未分类' : '全部分类')} aria-label="筛选分类">{category ? <CategoryDot color={category.color} /> : <Folder size={15} />}<span>{category?.name || (selectedCategory === 'uncategorized' ? '未分类' : '全部分类')}</span><span className="category-filter-short">{category?.name || (selectedCategory === 'uncategorized' ? '未分类' : '分类')}</span><ChevronDown size={14} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="task-action-menu category-menu" align="end" sideOffset={6} collisionPadding={12}><Menu.RadioGroup value={selectedCategory} onValueChange={selectCategory}>{[{ id: 'all', name: '全部分类' }, { id: 'uncategorized', name: '未分类' }].map(row => <Menu.RadioItem key={row.id} className="category-menu-item" value={row.id}><span>{row.name}</span><Menu.ItemIndicator><Check size={14} /></Menu.ItemIndicator></Menu.RadioItem>)}{categories.map(row => <Menu.RadioItem key={row.id} className="category-menu-item" value={row.id}><CategoryDot color={row.color} /><span>{row.name}</span><Menu.ItemIndicator><Check size={14} /></Menu.ItemIndicator></Menu.RadioItem>)}</Menu.RadioGroup><Menu.Separator className="task-action-separator" /><Menu.Item className="category-menu-item" onSelect={() => setManage(true)}><Settings2 size={15} /><span>管理分类</span></Menu.Item></Menu.Content></Menu.Portal></Menu.Root><CategoryManager open={manage} onClose={() => setManage(false)} /></>;
}

function ColorChoices({ value, onChange, disabled }: { value: CategoryColor; onChange: (value: CategoryColor) => void; disabled: boolean }) {
  return <div className="category-colors" role="group" aria-label="分类颜色">{categoryColors.map(color => <button key={color.value} type="button" aria-label={color.name} aria-pressed={value === color.value} disabled={disabled} onClick={() => onChange(color.value)}><CategoryDot color={color.value} />{value === color.value && <Check size={13} aria-hidden="true" />}</button>)}</div>;
}

export function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { categories, tasks, archivedTasks, busy, mutate } = useAppStore();
  const [name, setName] = useState('');
  const [color, setColor] = useState<CategoryColor>('sage');
  const [editing, setEditing] = useState<TaskCategory | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setName(''); setColor('sage'); setEditing(null); setDeleting(null); setError(''); } }, [open]);
  async function save() {
    if (!name.trim()) { setError('请输入分类名称'); return; }
    try {
      await mutate(editing ? `/categories/${editing.id}` : '/categories', { name: name.trim(), color }, editing ? 'PATCH' : 'POST', { feedback: false, expectedOwner: ownerIdentity() });
      toast.success(editing ? '分类已更新' : '分类已创建');
      setName(''); setEditing(null); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败'); }
  }
  async function move(index: number, offset: number) {
    const ids = categories.map(row => row.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    try { await mutate('/categories/reorder', { ids }, 'POST', { feedback: false, expectedOwner: ownerIdentity() }); } catch { /* Store displays the error. */ }
  }
  async function remove(row: TaskCategory) {
    try {
      await mutate(`/categories/${row.id}`, undefined, 'DELETE', { feedback: false, expectedOwner: ownerIdentity() });
      if (editing?.id === row.id) { setEditing(null); setName(''); }
      setDeleting(null); toast.success('分类已删除，任务回到未分类');
    } catch { /* Store displays the error. */ }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent className="category-manager"><DialogHeader><DialogTitle>管理分类</DialogTitle><DialogDescription>按自己的方式，整理想做的事。</DialogDescription></DialogHeader><form className="category-create" onSubmit={event => { event.preventDefault(); void save(); }}><label htmlFor="category-name">{editing ? '修改分类' : '新分类'}</label><div className="category-name-row"><Input id="category-name" aria-label="分类名称" value={name} maxLength={20} placeholder="例如：学习" disabled={busy} onChange={event => { setName(event.target.value); setError(''); }} /><Button type="submit" disabled={busy}>{editing ? '保存修改' : <><Plus size={15} />添加</>}</Button></div><div className="category-color-row"><ColorChoices value={color} onChange={setColor} disabled={busy} />{editing && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setEditing(null); setName(''); setError(''); }}>取消编辑</Button>}</div>{error && <p className="category-error" role="alert">{error}</p>}</form><div className="category-manager-list" role="region" aria-label="分类列表">{!categories.length && <p className="category-empty">创建第一个分类，已有任务随时可以归类。</p>}{categories.map((row, index) => <div className="category-manager-row" key={row.id}><div className="category-row-top"><CategoryDot color={row.color} /><span title={row.name}>{row.name}</span><div className="category-row-actions"><button type="button" className="icon-button" disabled={busy || index === 0} aria-label={`上移${row.name}`} onClick={() => void move(index, -1)}><ArrowUp size={15} /></button><button type="button" className="icon-button" disabled={busy || index === categories.length - 1} aria-label={`下移${row.name}`} onClick={() => void move(index, 1)}><ArrowDown size={15} /></button><button type="button" className="icon-button" disabled={busy} aria-label={`编辑分类${row.name}`} onClick={() => { setEditing(row); setName(row.name); setColor(row.color); setError(''); setDeleting(null); document.getElementById('category-name')?.focus({ preventScroll: true }); }}><Pencil size={15} /></button><button type="button" className="icon-button" disabled={busy} aria-label={`删除分类${row.name}`} onClick={() => setDeleting(row.id)}><Trash2 size={15} /></button></div></div>{deleting === row.id && <div className="category-delete-confirm"><p>删除后，{[...tasks, ...archivedTasks].filter(task => task.category_id === row.id).length} 项任务回到未分类，进度与记录保留。</p><div><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>取消</Button><Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void remove(row)}>删除分类</Button></div></div>}</div>)}</div></DialogContent></Dialog>;
}
