'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
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

function ProgressTile({ fill, previous, receiptId, reduced, delay }: {
  fill: number; previous: number; receiptId?: string; reduced: boolean; delay: number;
}) {
  const tile = useRef<HTMLSpanElement>(null);
  const changed = Math.abs(fill - previous) > .00001;
  const decreasing = fill < previous;
  useEffect(() => {
    if (!receiptId || !changed || reduced || !tile.current) return;
    const animation = tile.current.animate(decreasing
      ? [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(2px)', opacity: .5 }, { transform: 'translateY(0)', opacity: 1 }]
      : [{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)' }, { transform: 'translateY(0)' }],
    { duration: decreasing ? 420 : 550, delay: decreasing ? 0 : delay, easing: 'cubic-bezier(.2,.8,.3,1)' });
    return () => animation.cancel();
  }, [receiptId, changed, decreasing, reduced, delay]);
  return <span ref={tile} className={`task-progress-tile ${fill >= 1 ? 'is-filled' : ''}`} data-fill={Math.round(fill * 100)} data-change={receiptId && changed ? decreasing ? 'decrease' : 'increase' : undefined} aria-hidden="true">
    <i className="task-progress-fill" style={{ width: `${fill * 100}%` }} />
    {receiptId && changed && <i key={receiptId} className={`task-progress-trail ${decreasing ? 'is-decrement' : ''}`} />}
  </span>;
}

export function TaskProgress({ label, ariaLabel, value, maximum, displayValue = value, unit, met = false, minimum = 0, pending = false, failed = false, effect, daily = false, course = false }: TaskProgressProps) {
  const reduced = Boolean(useReducedMotion());
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = matchMedia('(max-width: 767px)');
    const update = () => setCompact(media.matches); update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const previousNumber = useRef(displayValue);
  const direction = displayValue < previousNumber.current || displayValue === previousNumber.current && (effect?.amount ?? 0) < 0 ? -1 : 1;
  useEffect(() => { previousNumber.current = displayValue; }, [displayValue]);
  const fraction = maximum > 0 ? Math.max(0, Math.min(1, value / maximum)) : 0;
  const previous = effect ? daily ? effect.fromToday : effect.fromProgress : value;
  const previousFraction = maximum > 0 ? Math.max(0, Math.min(1, previous / maximum)) : 0;
  const count = Math.max(1, Math.min(maximum || 1, compact ? 10 : 20));
  const kind = pending ? 'pending' : failed ? 'failed' : effect?.kind || 'idle';
  const confirmedMet = met && !pending && !failed;
  const markMinimum = minimum > 0 && minimum < maximum;
  const counter = `${displayValue} / ${maximum} ${unit}`;
  const digits = String(displayValue).length;
  const numberSize = digits > 4 ? Math.max(12, Math.min(28, Math.floor((compact ? 74 : 90) / (digits * .65)))) : undefined;
  const receipt = !pending && !failed ? effect : undefined;
  const notification = pending ? '保存中' : failed ? '待确认 · 可重试' : effect?.kind === 'complete' ? '目标完成'
    : effect?.kind === 'daily' ? '今日达标' : effect ? `${effect.amount > 0 ? '+' : '−'}${Math.abs(effect.amount)} ${unit}` : '';

  return <div className={`task-progress ${confirmedMet ? 'is-met' : ''} ${course ? 'course-progress-enhanced' : ''}`} data-feedback={kind} data-motion={reduced ? 'reduced' : 'full'} data-design="steps">
    <div className={`task-progress-layout ${course ? 'course-drawer-progress' : ''}`}>
      <div className="task-progress-quantity">
        <strong className="task-progress-counter" title={counter} aria-label={counter}>
          <span className="task-progress-number" style={{ minWidth: `${digits}ch`, fontSize: numberSize }} aria-hidden="true"><AnimatePresence initial={false} mode="popLayout" custom={direction}><motion.span key={displayValue} custom={direction} variants={{ enter: (value: number) => ({ y: reduced ? 0 : value * 10, opacity: 0 }), exit: (value: number) => ({ y: reduced ? 0 : value * -10, opacity: 0 }) }} initial={reduced ? false : 'enter'} animate={{ y: 0, opacity: 1 }} exit="exit" transition={{ duration: reduced ? 0 : .25 }}>{displayValue}</motion.span></AnimatePresence></span><span className="task-progress-denominator" aria-hidden="true"> / {maximum} <span className="task-progress-unit">{unit}</span></span>
        </strong>
      </div>
      <div className="task-progress-body">
        <div className="task-progress-label">
          <span className="task-progress-caption"><span>{label}</span>
            <AnimatePresence initial={false} mode="wait">{notification && <motion.small key={pending ? 'pending' : failed ? 'failed' : effect?.id} role="status" className={`task-progress-feedback ${kind}`} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -4 }} transition={{ duration: reduced ? 0 : .16 }}>{(kind === 'daily' || kind === 'complete') && <Check size={12} aria-hidden="true" />}{notification}</motion.small>}</AnimatePresence>
          </span>
          <span className="task-progress-percentage" aria-hidden="true">{Math.round(fraction * 100)}<small>%</small></span>
        </div>
        <div className="task-progress-rail" role="progressbar" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={value} aria-valuetext={`${daily ? '今日 ' : ''}${counter}`} style={{ '--progress-columns': count } as CSSProperties}>
          {Array.from({ length: count }, (_, index) => <ProgressTile key={index} fill={Math.max(0, Math.min(1, fraction * count - index))} previous={Math.max(0, Math.min(1, previousFraction * count - index))} receiptId={receipt?.id} reduced={reduced} delay={Math.max(0, index - Math.floor(previousFraction * count)) * 18} />)}
          {markMinimum && <span className="task-progress-minimum" style={{ left: `${minimum / maximum * 100}%` }} title={`最小完成量 ${minimum} ${unit}`}><span className="sr-only">最小完成量 {minimum} {unit}</span></span>}
          {receipt && (receipt.kind === 'daily' || receipt.kind === 'complete') && <span key={`sweep-${receipt.id}`} className="task-progress-sweep" aria-hidden="true" />}
        </div>
      </div>
    </div>
  </div>;
}
