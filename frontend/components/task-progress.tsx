'use client';

import { useEffect, useId, useRef, type CSSProperties, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { ProgressFeedback } from '@/lib/progress-feedback';
import './progress-motion.css';

type ProgressTexture = 'woven' | 'leaf' | 'honeycomb';

const particleDirections = [
  [-32, -18], [-20, -28], [-6, -32], [12, -30], [26, -20], [32, -4],
  [22, 16], [8, 25], [-11, 21], [-27, 8], [-38, -5], [4, -23],
  [18, -12], [-15, -15], [29, 8], [-2, 29],
] as const;

function ParticleBurst({ count, spread, delay = 0, duration, celebrate }: {
  count: number; spread: number; delay?: number; duration: number; celebrate: boolean;
}) {
  return <>
    {Array.from({ length: count }, (_, index) => {
      const direction = particleDirections[index % particleDirections.length];
      return <i key={index} className={`progress-particle ${index % 7 === 0 ? 'is-spark' : index % 3 === 1 ? 'is-petal' : ''}`} style={{
        '--particle-x': `${direction[0] * spread}px`,
        '--particle-y': `${direction[1] * spread}px`,
        '--particle-turn': `${index % 2 ? 210 : -150}deg`,
        '--particle-delay': `${delay + index * 10}ms`,
        '--particle-duration': `${duration}ms`,
        '--particle-color': `var(${index % 4 === 0 ? '--accent' : index % 4 === 2 ? '--success' : '--progress-ink'})`,
      } as CSSProperties} />;
    })}
    {celebrate && <i className="progress-particle-ring" />}
  </>;
}

function ProgressParticles({ receipt, fraction, fill }: {
  receipt: ProgressFeedback; fraction: number; fill: RefObject<HTMLDivElement | null>;
}) {
  const origin = useRef<HTMLSpanElement>(null);
  const complete = receipt.kind === 'complete';
  const dailyMet = receipt.kind === 'daily';
  useEffect(() => {
    const track = fill.current?.parentElement;
    if (!origin.current || !fill.current || !track) return;
    const trackWidth = track.getBoundingClientRect().width;
    const start = trackWidth ? Math.max(0, Math.min(1, fill.current.getBoundingClientRect().width / trackWidth)) : fraction;
    const animation = origin.current.animate([
      { left: `${start * 100}%` }, { left: `${fraction * 100}%` },
    ], { duration: 600, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
    return () => animation.cancel();
  }, [receipt.id, fraction, fill]);

  return <span className="task-progress-particles" data-kind={receipt.kind} aria-hidden="true">
    <span ref={origin} className="progress-particle-origin" style={{ left: `${fraction * 100}%` }}>
      <ParticleBurst count={complete ? 11 : dailyMet ? 16 : receipt.amount > 1 ? 11 : 7} spread={complete ? 1.05 : dailyMet ? 1 : .85} duration={complete ? 1050 : 900} celebrate={complete || dailyMet} />
    </span>
    {complete && [.28, .64].map((position, index) => <span key={position} className="progress-particle-origin" style={{ left: `${fraction * position * 100}%` }}>
      <ParticleBurst count={8} spread={1} delay={80 + index * 80} duration={1050} celebrate />
    </span>)}
  </span>;
}

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
  texture?: ProgressTexture;
}

function PatternTexture({ texture, receipt, reduced }: {
  texture: ProgressTexture;
  receipt?: ProgressFeedback;
  reduced: boolean;
}) {
  const patternId = useId();
  const pattern = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!receipt || reduced || !pattern.current) return;
    const offset = receipt.amount < 0 ? 28 : -28;
    const animation = pattern.current.animate([
      { transform: `translateX(${offset}px)` },
      { transform: 'translateX(0)' },
    ], { duration: receipt.kind === 'complete' ? 900 : 650, easing: 'cubic-bezier(.16,1,.3,1)' });
    return () => animation.cancel();
  }, [receipt?.id, receipt?.amount, receipt?.kind, reduced]);

  return <svg ref={pattern} className="task-progress-texture" aria-hidden="true" focusable="false">
    <defs>
      <pattern id={patternId} width="28" height="24" patternUnits="userSpaceOnUse">
        {texture === 'woven' && <g fill="none" stroke="currentColor" strokeWidth=".9" strokeLinecap="round">
          <path d="M-7 0 7 12-7 24M7 0 21 12 7 24M21 0 35 12 21 24" />
          <path d="M-7 6 7 18M7-6 21 6M7 18 21 30M21 6 35 18" opacity=".42" />
        </g>}
        {texture === 'leaf' && <g fill="none" stroke="currentColor" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19C2 12 6 7 13 6c1 7-3 12-9 13ZM4 19l8-11M18 7c-1 6 1 10 6 11 2-5 0-9-6-11ZM18 7l5 9" />
        </g>}
        {texture === 'honeycomb' && <g fill="none" stroke="currentColor" strokeWidth=".85" strokeLinejoin="round">
          <path d="m7 1 14 0 7 11-7 11H7L0 12ZM7 1l-7-12M21 1l7-12M7 23 0 35M21 23l7 12" />
          <path d="m9 5 10 0 4 7-4 7H9l-4-7Z" opacity=".26" />
        </g>}
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill={`url(#${patternId})`} />
  </svg>;
}

export function TaskProgress({ label, ariaLabel, value, maximum, displayValue = value, unit, met = false, minimum = 0, pending = false, failed = false, effect, daily = false, course = false, texture = course ? 'honeycomb' : daily ? 'leaf' : 'woven' }: TaskProgressProps) {
  const reduced = Boolean(useReducedMotion());
  const fill = useRef<HTMLDivElement>(null);
  const previousNumber = useRef(displayValue);
  const direction = displayValue < previousNumber.current || displayValue === previousNumber.current && (effect?.amount ?? 0) < 0 ? -1 : 1;
  useEffect(() => { previousNumber.current = displayValue; }, [displayValue]);
  const fraction = maximum > 0 ? Math.max(0, Math.min(1, value / maximum)) : 0;
  const kind = pending ? 'pending' : failed ? 'failed' : effect?.kind || 'idle';
  const confirmedMet = met && !pending && !failed;
  const markMinimum = minimum > 0 && minimum < maximum;
  const counter = `${displayValue} / ${maximum} ${unit}`;
  const digits = String(displayValue).length;
  const numberSize = digits > 5 ? Math.max(12, 18 - (digits - 5)) : undefined;
  const receipt = !pending && !failed ? effect : undefined;
  const notification = pending ? '保存中' : failed ? '待确认 · 可重试' : effect?.kind === 'complete' ? '目标完成'
    : effect?.kind === 'daily' ? '今日达标' : effect ? `${effect.amount > 0 ? '+' : '−'}${Math.abs(effect.amount)} ${unit}` : '';

  return <div className={`task-progress ${confirmedMet ? 'is-met' : ''} ${course ? 'course-progress-enhanced' : ''}`} data-feedback={kind} data-motion={reduced ? 'reduced' : 'full'} data-design="pattern" data-pattern={texture}>
    <div className={`task-progress-layout ${course ? 'course-drawer-progress' : ''}`}>
      <div className="task-progress-label">
        <span className="task-progress-caption"><span>{label}</span>
          <AnimatePresence initial={false} mode="wait">{notification && <motion.small key={pending ? 'pending' : failed ? 'failed' : effect?.id} role="status" className={`task-progress-feedback ${kind}`} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -4 }} transition={{ duration: reduced ? 0 : .16 }}>{(kind === 'daily' || kind === 'complete') && <Check size={12} aria-hidden="true" />}{notification}</motion.small>}</AnimatePresence>
        </span>
        <strong className="task-progress-counter" title={counter} aria-label={counter}>
          <span className="task-progress-number" style={{ fontSize: numberSize }} aria-hidden="true"><AnimatePresence initial={false} mode="popLayout" custom={direction}><motion.span key={displayValue} custom={direction} variants={{ enter: (value: number) => ({ y: reduced ? 0 : value * 10, opacity: 0 }), exit: (value: number) => ({ y: reduced ? 0 : value * -10, opacity: 0 }) }} initial={reduced ? false : 'enter'} animate={{ y: 0, opacity: 1 }} exit="exit" transition={{ duration: reduced ? 0 : .25 }}>{displayValue}</motion.span></AnimatePresence></span><span className="task-progress-denominator" aria-hidden="true"> / {maximum} <span className="task-progress-unit">{unit}</span></span>
        </strong>
      </div>
      <div className="task-progress-rail" role="progressbar" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={value} aria-valuetext={`${daily ? '今日 ' : ''}${counter}`}>
        <div className="task-progress-track">
          <div ref={fill} className="task-progress-fill" style={{ width: `${fraction * 100}%` }}>
            <PatternTexture texture={texture} receipt={receipt} reduced={reduced} />
          </div>
          {receipt && (receipt.kind === 'daily' || receipt.kind === 'complete') && <span key={`sweep-${receipt.id}`} className="task-progress-sweep" aria-hidden="true" />}
        </div>
        {markMinimum && <span className="task-progress-minimum" style={{ left: `${minimum / maximum * 100}%` }} title={`最小完成量 ${minimum} ${unit}`}><span className="sr-only">最小完成量 {minimum} {unit}</span></span>}
        {receipt?.kind === 'complete' && <span key={`finish-${receipt.id}`} className="task-progress-finish" aria-hidden="true" />}
        {receipt && receipt.amount > 0 && !reduced && <ProgressParticles key={receipt.id} receipt={receipt} fraction={fraction} fill={fill} />}
      </div>
    </div>
  </div>;
}
