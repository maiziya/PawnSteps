'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { ProgressFeedback } from '@/lib/progress-feedback';
import './progress-motion.css';

type ProgressTexture = 'woven' | 'leaf' | 'honeycomb';

const particleDirections = [
  [-23, -12], [-17, 10], [-9, -20], [4, -16], [14, -8], [-26, 2],
  [-2, 17], [11, 9], [-20, -4], [-13, 18], [17, -15], [-5, -10],
] as const;

interface ParticleEvent {
  receipt: ProgressFeedback;
  start: number;
  end: number;
}

function ParticleTrail({ event }: { event: ParticleEvent }) {
  const origin = useRef<HTMLSpanElement>(null);
  const complete = event.receipt.kind === 'complete';
  const dailyMet = event.receipt.kind === 'daily';
  const count = complete ? 12 : dailyMet ? 9 : event.receipt.amount > 1 ? 7 : 4;
  const duration = complete ? 760 : dailyMet ? 660 : 560;
  const offset = Number(event.receipt.id.split('-').at(-1)) || 0;
  useEffect(() => {
    if (!origin.current) return;
    const animation = origin.current.animate([
      { left: String(event.start * 100) + '%' }, { left: String(event.end * 100) + '%' },
    ], { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
    return () => animation.cancel();
  }, [event]);

  return <span ref={origin} className="progress-particle-origin" data-burst-id={event.receipt.id} style={{ left: String(event.end * 100) + '%' }}>
    {Array.from({ length: count }, (_, index) => {
      const direction = particleDirections[(index + offset) % particleDirections.length];
      return <i key={index} className={'progress-particle' + (index % 3 === 0 ? ' is-streak' : '')} style={{
        '--particle-x': String(direction[0] * (complete ? 1.15 : 1)) + 'px',
        '--particle-y': String(direction[1] * (complete ? 1.15 : 1)) + 'px',
        '--particle-angle': String(Math.atan2(direction[1], direction[0]) * 180 / Math.PI) + 'deg',
        '--particle-delay': String(index * 14) + 'ms',
        '--particle-duration': String(duration) + 'ms',
        '--particle-color': index % 3 === 0 ? 'var(--progress-pattern-color)' : 'var(--progress-ink)',
      } as CSSProperties} />;
    })}
  </span>;
}

function ProgressParticles({ receipt, fraction, fill, reduced }: {
  receipt?: ProgressFeedback; fraction: number; fill: RefObject<HTMLDivElement | null>; reduced: boolean;
}) {
  const [events, setEvents] = useState<ParticleEvent[]>([]);
  const seen = useRef(receipt?.id);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (reduced || (receipt && receipt.amount < 0)) {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      setEvents(previous => previous.length ? [] : previous);
      if (receipt) seen.current = receipt.id;
      return;
    }
    if (!receipt || seen.current === receipt.id) return;
    seen.current = receipt.id;
    const track = fill.current?.parentElement;
    const trackWidth = track?.getBoundingClientRect().width || 0;
    const start = trackWidth && fill.current ? Math.max(0, Math.min(1, fill.current.getBoundingClientRect().width / trackWidth)) : fraction;
    const event = { receipt, start, end: fraction };
    // Keep earlier flights alive; only committed receipts emit new particles.
    setEvents(previous => [...previous, event].slice(-4));
    timers.current.set(receipt.id, setTimeout(() => {
      setEvents(previous => previous.filter(item => item.receipt.id !== receipt.id));
      timers.current.delete(receipt.id);
    }, receipt.kind === 'complete' ? 1050 : 850));
  }, [receipt?.id, receipt?.amount, receipt?.kind, fraction, fill, reduced]);
  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);

  if (!events.length || reduced) return null;
  return <span className="task-progress-particles" data-kind={events[events.length - 1].receipt.kind} aria-hidden="true">
    {events.map(event => <ParticleTrail key={event.receipt.id} event={event} />)}
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
  const animation = useRef<Animation | null>(null);
  const seen = useRef(receipt?.id);
  useEffect(() => {
    const element = pattern.current;
    if (!element) return;
    if (reduced) {
      const transform = getComputedStyle(element).transform;
      const phase = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41 % 28;
      element.style.transform = 'translateX(' + phase + 'px)';
      animation.current?.cancel();
      animation.current = null;
      seen.current = receipt?.id;
      return;
    }
    if (!receipt || seen.current === receipt.id) return;
    seen.current = receipt.id;
    const transform = getComputedStyle(element).transform;
    const phase = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41 % 28;
    element.style.transform = 'translateX(' + phase + 'px)';
    animation.current?.cancel();
    const target = phase + (receipt.amount < 0 ? -28 : 28);
    const next = element.animate([
      { transform: 'translateX(' + phase + 'px)' }, { transform: 'translateX(' + target + 'px)' },
    ], { duration: receipt.kind === 'complete' ? 650 : 480, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
    animation.current = next;
    next.onfinish = () => {
      if (animation.current !== next) return;
      element.style.transform = 'translateX(' + target % 28 + 'px)';
      next.cancel();
      animation.current = null;
    };
  }, [receipt?.id, receipt?.amount, receipt?.kind, reduced]);
  useEffect(() => () => {
    animation.current?.cancel();
    animation.current = null;
  }, []);

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
  const confirmedMet = met;
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
            <PatternTexture texture={texture} receipt={effect} reduced={reduced} />
          </div>
          {receipt && (receipt.kind === 'daily' || receipt.kind === 'complete') && <span key={`sweep-${receipt.id}`} className="task-progress-sweep" aria-hidden="true" />}
        </div>
        {markMinimum && <span className="task-progress-minimum" style={{ left: `${minimum / maximum * 100}%` }} title={`最小完成量 ${minimum} ${unit}`}><span className="sr-only">最小完成量 {minimum} {unit}</span></span>}
        {receipt?.kind === 'complete' && <span key={`finish-${receipt.id}`} className="task-progress-finish" aria-hidden="true" />}
        <ProgressParticles receipt={effect} fraction={fraction} fill={fill} reduced={reduced} />
      </div>
    </div>
  </div>;
}
