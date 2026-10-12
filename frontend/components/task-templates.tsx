'use client';

import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowRight, BookOpen, CalendarDays, Flag, Layers, LoaderCircle, MoreHorizontal, Pencil, Sun, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ownerIdentity } from '@/lib/api';
import { useAppStore } from '@/lib/store';
import type { Task, TaskTemplate, TemplateDetails } from '@/lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import './task-templates.css';

const kinds = { normal: { name: '目标任务', Icon: Flag }, daily: { name: '每日打卡', Icon: Sun }, plan: { name: '天数计划', Icon: CalendarDays }, course: { name: '课程学习', Icon: BookOpen } };
function TemplateCaption({ template }: { template: TaskTemplate }) {
  return <span className="template-caption">{kinds[template.kind].name} · {template.target === 0 ? '休息计划' : `${template.target} ${template.kind === 'daily' ? '天' : template.unit}`}</span>;
}

export function TemplatePicker({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (template: TemplateDetails) => void }) {
  const templates = useAppStore(state => state.templates);
  const busy = useAppStore(state => state.busy);
  const mutate = useAppStore(state => state.mutate);
  const [tab, setTab] = useState<'builtin' | 'custom'>('builtin');
  const [query, setQuery] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [deleting, setDeleting] = useState<TaskTemplate | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const active = useRef(open);
  active.current = open;
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    setQuery(''); setError(''); setLoadingId(null); setEditingId(null); setDeleting(null);
    const owner = ownerIdentity();
    void useAppStore.getState().mutate('/templates', undefined, 'GET', { feedback: false, quiet: true, expectedOwner: owner }).catch(() => setError('模板加载失败，请关闭后重试。'));
    return () => { request.current?.abort(); };
  }, [open]);
  async function choose(template: TaskTemplate) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const owner = ownerIdentity();
    setLoadingId(template.id); setError('');
    try {
      const detail = await api<TemplateDetails>(`/templates/${template.id}`, { signal: controller.signal });
      if (!active.current || controller.signal.aborted || ownerIdentity() !== owner) return;
      onSelect(detail); onClose();
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '模板暂时不可用');
    } finally { if (request.current === controller) setLoadingId(null); }
  }
  async function rename(template: TaskTemplate) {
    if (!draftName.trim()) { setError('请输入模板名称'); return; }
    try {
      await mutate(`/templates/${template.id}`, { name: draftName.trim() }, 'PATCH', { feedback: false, expectedOwner: ownerIdentity() });
      setEditingId(null); setError(''); toast.success('模板名称已更新');
    } catch { /* Mutation errors are displayed by the store. */ }
  }
  const visible = templates.filter(template => template.is_builtin === (tab === 'builtin') && template.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogContent className="template-picker-dialog" overlayClassName="template-picker-overlay" onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus({ preventScroll: true }); }}>
      <DialogTitle ref={title} tabIndex={-1} className="template-title"><Layers size={20} />选择任务模板</DialogTitle>
      <DialogDescription className="template-description">套用常用配置，再调整成适合你的目标。</DialogDescription>
      <Input className="template-search" aria-label="搜索模板" placeholder="搜索模板" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="template-tabs" role="group" aria-label="模板类型"><button type="button" aria-pressed={tab === 'builtin'} onClick={() => setTab('builtin')}>内置模板</button><button type="button" aria-pressed={tab === 'custom'} onClick={() => setTab('custom')}>我的模板</button></div>
      <div className="template-list">
        {visible.map(template => {
          const Icon = kinds[template.kind].Icon;
          return <div className="template-row" key={template.id}>
            {editingId === template.id ? <div className="template-rename"><Input autoFocus maxLength={60} aria-label="新的模板名称" value={draftName} onChange={event => setDraftName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void rename(template); } }} /><button type="button" disabled={busy} onClick={() => void rename(template)}>保存名称</button><button type="button" disabled={busy} onClick={() => setEditingId(null)}>取消</button></div> : <>
              <button type="button" className="template-use" aria-label={`应用模板：${template.name}`} disabled={busy || Boolean(loadingId)} onClick={() => void choose(template)}><Icon size={19} /><span><strong title={template.name}>{template.name}</strong><TemplateCaption template={template} /></span>{loadingId === template.id ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowRight size={16} />}</button>
              {!template.is_builtin && <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" className="icon-button template-menu-trigger" disabled={busy || Boolean(loadingId)} aria-label={`模板操作：${template.name}`}><MoreHorizontal size={17} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="task-action-menu template-action-menu" align="end" sideOffset={5} collisionPadding={12}><DropdownMenu.Item className="task-action-item" onSelect={() => { setEditingId(template.id); setDraftName(template.name); }}><Pencil size={15} />重命名模板</DropdownMenu.Item><DropdownMenu.Item className="task-action-item task-action-delete" onSelect={() => setDeleting(template)}><Trash2 size={15} />删除模板</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}
            </>}
          </div>;
        })}
        {!visible.length && <div className="template-empty"><Layers size={23} /><p>{query.trim() ? '没有匹配的模板' : '还没有自定义模板'}</p>{!query.trim() && <small>从任务菜单选择“保存为模板”，以后直接套用。</small>}</div>}
      </div>
      {error && <p className="template-error" role="alert">{error}</p>}
    </DialogContent></Dialog>
    <Dialog open={Boolean(deleting) && open} onOpenChange={value => { if (!value && !busy) setDeleting(null); }}><DialogContent className="template-confirm-dialog" overlayClassName="template-confirm-overlay"><DialogTitle>删除模板</DialogTitle><DialogDescription className="template-description">删除“{deleting?.name}”的保存配置，已创建的任务继续保留。</DialogDescription><div className="template-actions"><Button variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>取消</Button><Button variant="destructive" disabled={busy} onClick={() => void (async () => { if (!deleting) return; try { await mutate(`/templates/${deleting.id}`, undefined, 'DELETE', { feedback: false, expectedOwner: ownerIdentity() }); setDeleting(null); toast('模板已删除'); } catch {} })()}>删除模板</Button></div></DialogContent></Dialog>
  </>;
}

export function SaveTemplateDialog({ task, open, onClose }: { task: Task; open: boolean; onClose: () => void }) {
  const allTemplates = useAppStore(state => state.templates);
  const templates = allTemplates.filter(template => !template.is_builtin);
  const busy = useAppStore(state => state.busy);
  const mutate = useAppStore(state => state.mutate);
  const [name, setName] = useState('');
  const [existingId, setExistingId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setName(task.name.slice(0, 60)); setExistingId(''); setError(''); } }, [open, task.id, task.owner_id]);
  async function save() {
    if (!name.trim()) { setError('请输入模板名称'); return; }
    try {
      await mutate(existingId ? `/templates/${existingId}` : '/templates', { name: name.trim(), source_task_id: task.id }, existingId ? 'PATCH' : 'POST', { feedback: false, expectedOwner: task.owner_id });
      toast.success(existingId ? '模板配置已更新' : '模板已保存'); onClose();
    } catch { /* Mutation errors are displayed by the store. */ }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent className="template-save-dialog">
    <DialogTitle className="template-title"><Layers size={20} />保存为模板</DialogTitle>
    <DialogDescription className="template-description">保存“{task.name}”的常用配置，以后新建时直接套用。</DialogDescription>
    <form className="template-save-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      {templates.length > 0 && <label>保存方式<select className="field" aria-label="保存方式" value={existingId} disabled={busy} onChange={event => { setExistingId(event.target.value); const existing = templates.find(template => template.id === event.target.value); setName(existing?.name || task.name.slice(0, 60)); }}><option value="">创建新模板</option>{templates.map(template => <option value={template.id} key={template.id}>更新：{template.name}</option>)}</select></label>}
      <label>模板名称<Input aria-label="模板名称" maxLength={60} value={name} disabled={busy} onChange={event => { setName(event.target.value); setError(''); }} /></label>
      {error && <p className="template-error" role="alert">{error}</p>}
      <div className="template-actions"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>{busy && <LoaderCircle size={15} className="animate-spin" />}{existingId ? '更新模板' : '保存模板'}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
