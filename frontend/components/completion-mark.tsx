'use client';

import { Check } from 'lucide-react';
import './progress-motion.css';

export function CompletionMark({ celebrate = false }: { celebrate?: boolean }) {
  return <span className={`completion-mark ${celebrate ? 'is-celebrating' : ''}`} aria-hidden="true">
    <span className="completion-mark-ring" />
    <Check size={20} strokeWidth={2.4} />
    {celebrate && <span className="completion-petals">{Array.from({ length: 6 }, (_, index) => <i key={index} style={{ transform: `rotate(${index * 60}deg)` }}><b /></i>)}</span>}
  </span>;
}
