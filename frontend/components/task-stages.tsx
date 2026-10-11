'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Flag, Plus, Trash2 } from 'lucide-react';
import type { Task, TaskStage } from '@/lib/types';
import { quarterStages, stageProgress, stageUnit, type StageFeedback } from '@/lib/stages';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import './task-stages.css';

export function TaskStageSummary({ task, feedback }: { task: Task; feedback?: StageFeedback }) {
  const reduced = Boolean(useReducedMotion());
  const state = stageProgress(task);
  if (!state.total) return null;
  const next = state.next_stage;
  const reached = feedback?.stages || [];
  const earnedLabel = reached.length > 1 ? `达成 ${reached.length} 个阶段` : reached.length ? `已达成 · ${reached[0].name || '阶段目标'}` : '';
  const label = earnedLabel || (next ? `下一阶段 · ${next.name}` : '全部阶段已达成');
  return <div className={`task-stage-summary ${reached.length ? 'is-celebrating' : ''} ${!next ? 'is-complete' : ''}`} aria-label={`${task.name}阶段目标`}>
    {!next || reached.length ? <Check size={13} aria-hidden="true" /> : <Flag size={13} aria-hidden="true" />}
    <motion.span key={feedback?.id || 'next'} className="task-stage-label" title={label} initial={reached.length && !reduced ? { opacity: .4, y: 3 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }}>{label}</motion.span>
    {next ? <span className="task-stage-distance">还差 <strong>{next.remaining}</strong> {stageUnit(task)}</span> : <span className="task-stage-distance">{state.completed} / {state.total}</span>}
    {earnedLabel && <span className="sr-only" role="status">{earnedLabel}</span>}
  </div>;
}

export function TaskStageEditor({ open, onClose, value, maximum, unit, onSave }: {
  open: boolean; onClose: () => void; value: TaskStage[]; maximum: number; unit: string; onSave: (stages: TaskStage[]) => void;
}) {
  const [rows, setRows] = useState<{ key: number; value: string; name: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) { setRows(value.map((stage, index) => ({ key: index, value: String(stage.value), name: stage.name }))); setError(''); }
  }, [open, value]);
  function save() {
    if (rows.some(row => !/^\d+$/.test(row.value) || Number(row.value) < 1 || Number(row.value) > maximum)) {
      setError(`阶段节点需为 1–${maximum} 的整数，不能超过总目标。`); return;
    }
    if (new Set(rows.map(row => Number(row.value))).size !== rows.length) { setError('阶段节点不能重复。'); return; }
    if (rows.some(row => row.name.trim().length > 40)) { setError('阶段名称最多 40 个字。'); return; }
    onSave(rows.map(row => ({ value: Number(row.value), name: row.name.trim() })).sort((a, b) => a.value - b.value));
    onClose();
  }
  return <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}><DialogContent className="stage-editor-dialog" overlayClassName="stage-editor-overlay">
    <DialogTitle className="stage-editor-title"><Flag size={19} />阶段目标</DialogTitle>
    <DialogDescription className="stage-editor-description">把总目标 {maximum} {unit} 分成几个节点，最多 6 个。</DialogDescription>
    <div className="stage-editor-tools"><span>按累计进度设置</span><button type="button" disabled={maximum < 1} onClick={() => { setRows(quarterStages(maximum).map((stage, index) => ({ key: index, value: String(stage.value), name: stage.name }))); setError(''); }}>均分四阶段</button></div>
    <div className="stage-editor-grid stage-editor-labels" aria-hidden="true"><span>累计达到（{unit}）</span><span>阶段名称 · 可选</span><span /></div>
    <div className="stage-editor-rows">
      {rows.map((row, index) => <div key={row.key} className="stage-editor-grid"><Input type="number" inputMode="numeric" min={1} max={maximum} aria-label={`阶段 ${index + 1} 节点`} value={row.value} onChange={event => { setRows(current => current.map(item => item.key === row.key ? { ...item, value: event.target.value } : item)); setError(''); }} /><Input maxLength={40} placeholder={`第 ${index + 1} 阶段`} aria-label={`阶段 ${index + 1} 名称`} value={row.name} onChange={event => setRows(current => current.map(item => item.key === row.key ? { ...item, name: event.target.value } : item))} /><button type="button" className="icon-button" aria-label={`删除阶段 ${index + 1}`} onClick={() => { setRows(current => current.filter(item => item.key !== row.key)); setError(''); }}><Trash2 size={15} /></button></div>)}
      {!rows.length && <p className="stage-editor-empty">添加你的第一个阶段，或使用四等分建议。</p>}
    </div>
    <button type="button" className="stage-editor-add" disabled={rows.length >= 6 || maximum < 1} onClick={() => setRows(current => [...current, { key: Math.max(-1, ...current.map(row => row.key)) + 1, value: '', name: '' }])}><Plus size={15} />添加阶段</button>
    {error && <p className="stage-editor-error" role="alert">{error}</p>}
    <div className="stage-editor-actions"><Button type="button" variant="ghost" onClick={onClose}>取消</Button><Button type="button" onClick={save}>保存阶段</Button></div>
  </DialogContent></Dialog>;
}
