'use client';

import { useId } from 'react';
import type { TaskSchedule } from '@/lib/types';

export const everydaySchedule = (): TaskSchedule => ({ mode: 'daily', weekdays: [], weekly_target: null });
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

export function scheduleLabel(value: TaskSchedule): string {
  return value.mode === 'weekly' ? `每周 ${value.weekly_target} 天` : value.mode === 'weekdays' ? value.weekdays.map(day => `周${weekdays[day]}`).join('、') : '每天';
}

export function ScheduleSelect({ value, onChange, compact = false }: { value: TaskSchedule; onChange: (value: TaskSchedule) => void; compact?: boolean }) {
  const id = useId();
  return <div className="schedule-select">
    <label htmlFor={id} className={compact ? 'sr-only' : undefined}>执行周期</label>
    <select id={id} className="field" value={value.mode} onChange={event => {
      const mode = event.target.value as TaskSchedule['mode'];
      onChange({ mode, weekdays: mode === 'weekdays' ? [0, 1, 2, 3, 4] : [], weekly_target: mode === 'weekly' ? 3 : null });
    }}>
      <option value="daily">每天</option><option value="weekdays">指定星期</option><option value="weekly">每周几天</option>
    </select>
  </div>;
}

export function ScheduleOptions({ value, onChange }: { value: TaskSchedule; onChange: (value: TaskSchedule) => void }) {
  if (value.mode === 'weekdays') return <div className="schedule-weekday-options"><div className="schedule-presets" role="group" aria-label="星期快捷选择">{[{ label: '工作日', days: [0, 1, 2, 3, 4] }, { label: '周末', days: [5, 6] }].map(preset => <button type="button" key={preset.label} aria-pressed={value.weekdays.join(',') === preset.days.join(',')} onClick={() => onChange({ ...value, weekdays: preset.days })}>{preset.label}</button>)}</div><div className="schedule-weekdays" role="group" aria-label="执行星期">
    {weekdays.map((label, index) => <button key={index} type="button" aria-label={`周${label}`} aria-pressed={value.weekdays.includes(index)} onClick={() => onChange({ ...value, weekdays: value.weekdays.includes(index) ? value.weekdays.filter(day => day !== index) : [...value.weekdays, index].sort() })}>{label}</button>)}
  </div></div>;
  if (value.mode === 'weekly') return <label className="schedule-weekly" title="同一天达标只计一次；首次不足一周按剩余天数调整。">每周达标<select className="field" aria-label="每周达标天数" value={value.weekly_target || 3} onChange={event => onChange({ ...value, weekly_target: Number(event.target.value) })}>{weekdays.map((_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select>天<span className="muted">周一至周日</span></label>;
  return null;
}
