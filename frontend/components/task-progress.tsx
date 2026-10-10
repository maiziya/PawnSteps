'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Footprints } from 'lucide-react';
import type { ProgressFeedback } from '@/lib/progress-feedback';
import './progress-motion.css';

interface TaskProgressProps {
  label: string;
  ariaLabel: string;
  value: number;
  maximum: number;
  displayValue?: number;
  unit: string;
  met?: boolean;
  minimum?: number;
  pending?: boolean;
  failed?: boolean;
  effect?: ProgressFeedback;
  daily?: boolean;
  course?: boolean;
}

export function TaskProgress({ label, ariaLabel, value, maximum, displayValue = value, unit, met = false, minimum = 0, pending = false, failed = false, effect, daily = false, course = false }: TaskProgressProps) {
  const reduced = useReducedMotion();
  const previousNumber = useRef(displayValue);
  const direction = displayValue < previousNumber.current || displayValue === previousNumber.current && (effect?.amount ?? 0) < 0 ? -1 : 1;
  useEffect(() => { previousNumber.current = displayValue; }, [displayValue]);
  const percentage = maximum > 0 ? Math.max(0, Math.min(100, value / maximum * 100)) : 0;
  const previous = effect ? daily ? effect.fromToday : effect.fromProgress : value;
  const previousPercentage = maximum > 0 ? Math.max(0, Math.min(100, previous / maximum * 100)) : 0;
  const kind = pending ? 'pending' : failed ? 'failed' : effect?.kind || 'idle';
  const confirmedMet = met && !pending && !failed;
  const markMinimum = minimum > 0 && minimum < maximum;
  const marks = maximum > 0 && maximum <= 10 ? maximum : 4;
  const counter = `${displayValue} / ${maximum} ${unit}`;
  const notification = pending ? '保存中' : failed ? '待确认 · 可重试' : effect?.kind === 'complete' ? '目标完成'
    : effect?.kind === 'daily' ? '今日达标' : effect ? `${effect.amount > 0 ? '+' : '−'}${Math.abs(effect.amount)} ${unit}` : '';

  return <div className={`task-progress ${confirmedMet ? 'is-met' : ''} ${course ? 'course-progress-enhanced' : ''}`} data-feedback={kind} data-motion={reduced ? 'reduced' : 'full'}>
    <div className={`task-progress-label ${course ? 'course-drawer-progress' : 'compact-course-meter-label'}`}>
      <span className="task-progress-caption"><Footprints size={12} aria-hidden="true" /><span>{label}</span>
        <AnimatePresence initial={false} mode="wait">{notification && <motion.small key={pending ? 'pending' : failed ? 'failed' : effect?.id} role="status" className={`task-progress-feedback ${kind}`} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -4 }} transition={{ duration: reduced ? 0 : .16 }}>{(kind === 'daily' || kind === 'complete') && <Check size={12} aria-hidden="true" />}{notification}</motion.small>}</AnimatePresence>
      </span>
      <strong className="task-progress-counter" title={counter} aria-label={counter}>
        <span className="task-progress-number" style={{ minWidth: `${String(Math.max(displayValue, maximum)).length}ch` }} aria-hidden="true"><AnimatePresence initial={false} mode="popLayout" custom={direction}><motion.span key={displayValue} custom={direction} variants={{ enter: (value: number) => ({ y: reduced ? 0 : value * 9, opacity: 0 }), exit: (value: number) => ({ y: reduced ? 0 : value * -9, opacity: 0 }) }} initial={reduced ? false : 'enter'} animate={{ y: 0, opacity: 1 }} exit="exit" transition={{ duration: reduced ? 0 : .25 }}>{displayValue}</motion.span></AnimatePresence></span><span aria-hidden="true"> / {maximum} <span className="task-progress-unit">{unit}</span></span>
      </strong>
    </div>
    <div className="task-progress-rail" role="progressbar" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={value} aria-valuetext={`${daily ? '今日 ' : ''}${counter}`}>
      <div className="task-progress-fill" style={{ width: `${percentage}%` }} />
      {effect && !pending && !failed && <span key={effect.id} aria-hidden="true" className={`task-progress-trail ${effect.kind === 'decrement' ? 'is-decrement' : ''}`} style={{ left: `${Math.min(percentage, previousPercentage)}%`, width: `${Math.abs(percentage - previousPercentage)}%` }} />}
      <span className="task-progress-divisions" aria-hidden="true">{Array.from({ length: Math.max(0, marks - 1) }, (_, index) => <i key={index} style={{ left: `${(index + 1) / marks * 100}%` }} />)}</span>
      {markMinimum && <span className="task-progress-minimum" style={{ left: `${minimum / maximum * 100}%` }} title={`最小完成量 ${minimum} ${unit}`}><span className="sr-only">最小完成量 {minimum} {unit}</span></span>}
      {effect && !pending && !failed && (effect.kind === 'daily' || effect.kind === 'complete') && <span key={`sweep-${effect.id}`} className="task-progress-sweep" aria-hidden="true" />}
    </div>
  </div>;
}
