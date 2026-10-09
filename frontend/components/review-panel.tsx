"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, CalendarCheck2, Check, ChevronLeft, ChevronRight, ClipboardCheck, Footprints, Moon, RefreshCw, Timer } from "lucide-react";
import { api, ownerIdentity } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useFocusStore } from "@/lib/focus-store";
import { compactFocusDuration, focusDuration, shiftDate, shortDate, weekStart, type WeeklyReview } from "@/lib/review-types";
import { Button } from "./ui/button";
import "./review.css";

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
function Difference({ value, previous, unit = '', time = false }: { value: number; previous: number; unit?: string; time?: boolean }) {
  const difference = value - previous;
  const amount = time ? focusDuration(Math.abs(difference)) : `${Math.abs(difference)}${unit}`;
  return <span className={`review-difference ${difference > 0 ? 'is-up' : ''}`}>{difference === 0 ? '与上周相同' : `比上周${difference > 0 ? '多' : '少'} ${amount}`}</span>;
}

function TimeAmount({ seconds }: { seconds: number }) {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return hours ? <>{hours}<small>小时</small>{minutes > 0 && <>{minutes}<small>分</small></>}</> : seconds >= 60 ? <>{minutes}<small>分钟</small></> : <>{seconds}<small>秒</small></>;
}

export function ReviewPanel({ onCalendar, onTask }: { onCalendar: () => void; onTask: (id: string) => void }) {
  const tasks = useAppStore(state => state.tasks), today = useAppStore(state => state.today), userId = useAppStore(state => state.user?.id);
  const focusRevision = useFocusStore(state => state.data?.revision);
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<WeeklyReview | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [chart, setChart] = useState<'tasks' | 'focus'>('tasks');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const thisMonday = today ? weekStart(today) : '';
  const requested = week || thisMonday;
  const shown = data?.week_start === requested ? data : null;
  useEffect(() => {
    if (!today) return;
    const controller = new AbortController(), owner = ownerIdentity();
    setLoading(true); setError('');
    api<WeeklyReview>(`/review/weekly${week ? `?week_of=${week}` : ''}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted && owner === ownerIdentity()) setData(result); })
      .catch(reason => { if (!controller.signal.aborted && owner === ownerIdentity()) setError(reason instanceof Error ? reason.message : '回顾暂时无法加载'); })
      .finally(() => { if (!controller.signal.aborted && owner === ownerIdentity()) setLoading(false); });
    return () => controller.abort();
  }, [week, today, tasks, userId, focusRevision, retry]);
  useEffect(() => setSelectedDay(null), [requested]);
  function move(offset: number) { setWeek(shiftDate(requested, offset)); }
  const current = shown?.current.summary, previous = shown?.previous.summary;
  const selected = shown?.current.days.find(day => day.date === selectedDay);
  const work = selected ? selected.tasks : shown?.current.tasks || [];
  const ceiling = Math.max(1, ...(shown?.current.days.map(day => chart === 'tasks' ? day.task_count : day.focus_seconds) || []));
  return <section className="review-page" aria-label="每周回顾" aria-busy={loading}>
    <div className="review-toolbar"><div className="review-week-nav"><button className="icon-button" aria-label="上一周" disabled={loading || requested <= '2000-01-03'} onClick={() => move(-7)}><ChevronLeft size={19} /></button><h2>{requested ? `${requested.slice(0, 4)}年 ${shortDate(requested)}—${shortDate(shiftDate(requested, 6))}` : '每周回顾'}</h2><button className="icon-button" aria-label="下一周" disabled={loading || requested >= thisMonday} onClick={() => move(7)}><ChevronRight size={19} /></button><Button size="sm" variant="ghost" disabled={loading || requested === thisMonday} onClick={() => setWeek(null)}>本周</Button></div><button className="review-calendar-link" onClick={onCalendar}><ArrowLeft size={14} />打卡日历</button></div>
    <p className="review-period-note">{shown ? `${shown.is_current_week ? `截至${shortDate(shown.through_date)}，` : ''}与${shortDate(shown.previous.start)}—${shortDate(shown.previous.end)}比较${shown.is_current_week ? '，均统计前 ' + shown.elapsed_days + ' 天' : ''}` : loading ? '正在整理这一周的记录' : '回看这一周的积累'}</p>
    {error ? <div className="error-banner" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} />重试</Button></div> : !shown ? <div className="review-loading" role="status"><span className="sr-only">正在加载每周回顾</span><div className="skeleton" /><div className="skeleton" /></div> : <>
      <div className="review-metrics" aria-label="本周统计">{[
        { label: '推进任务', value: current!.active_tasks, previous: previous!.active_tasks, unit: '项', Icon: Footprints },
        { label: '达标天数', value: current!.achieved_days, previous: previous!.achieved_days, unit: '天', Icon: CalendarCheck2 },
        { label: '专注时长', value: current!.focus_seconds, previous: previous!.focus_seconds, unit: '', Icon: Timer, time: true },
        { label: '达成目标', value: current!.completed_tasks, previous: previous!.completed_tasks, unit: '个', Icon: ClipboardCheck },
      ].map(item => <div className="review-metric" key={item.label} role="group" aria-label={item.label}><span><item.Icon size={16} />{item.label}</span><strong>{item.time ? <TimeAmount seconds={item.value} /> : <>{item.value}<small>{item.unit}</small></>}</strong><Difference value={item.value} previous={item.previous} unit={item.unit} time={item.time} /></div>)}</div>
      <div className="review-overview">
        <section className="review-rhythm panel" aria-label="每日积累"><div className="review-section-heading"><h3>每天的一小步</h3><div className="review-chart-tabs" role="group" aria-label="趋势指标"><button aria-pressed={chart === 'tasks'} onClick={() => setChart('tasks')}>任务</button><button aria-pressed={chart === 'focus'} onClick={() => setChart('focus')}>专注</button></div></div>
          <div className="review-chart" role="group" aria-label={chart === 'tasks' ? '每日任务进度' : '每日专注时长'}>{shown.current.days.map((day, index) => {
            const value = chart === 'tasks' ? day.task_count : day.focus_seconds;
            return <button key={day.date} className={`review-day ${selectedDay === day.date ? 'is-selected' : ''} ${day.is_future ? 'is-future' : ''}`} disabled={day.is_future} aria-pressed={selectedDay === day.date} aria-label={`星期${weekdays[index]}，${day.is_future ? '尚未到来' : `${day.task_count}项任务有进度，${day.achieved_count}项达标，专注${focusDuration(day.focus_seconds)}${day.is_rest ? '，休息日' : ''}`}`} title={`${shortDate(day.date)} · ${day.is_future ? '尚未到来' : day.task_count + '项任务 · 专注' + focusDuration(day.focus_seconds)}`} onClick={() => setSelectedDay(current => current === day.date ? null : day.date)}><span className="review-chart-value">{day.is_future ? '—' : value === 0 ? '0' : chart === 'tasks' ? value : compactFocusDuration(value)}</span><span className="review-bar-track"><span className={`review-bar ${day.achieved_count > 0 || chart === 'focus' ? 'is-met' : ''}`} style={{ height: `${value / ceiling * 100}%` }} /></span><span className="review-day-label">周{weekdays[index]}</span><span className="review-day-marker" aria-hidden="true">{day.achieved_count > 0 ? <i /> : day.is_rest ? <Moon size={10} /> : null}</span></button>;
          })}</div>
          <div className="review-chart-footer"><span><i />有达标记录</span><span>行动 {current!.active_days} 天 · 完整番茄 {current!.pomodoros} 轮</span></div>
        </section>
        <section className="review-quantities panel" aria-label="本周完成量"><div className="review-section-heading"><h3>完成量</h3><span>按计量单位</span></div><div className="review-quantity-list">{Object.keys(current!.quantities).length ? Object.entries(current!.quantities).map(([unit, amount]) => <div className="review-quantity" key={unit}><strong>{amount}<small>{unit}</small></strong><Difference value={amount} previous={previous!.quantities[unit] || 0} unit={unit} /></div>) : <p className="review-quantity-empty">{current!.focus_seconds > 0 ? '专注时间已留下，确认任务成果后会显示完成量。' : '记录一次任务进度，积累就会出现在这里。'}</p>}</div></section>
      </div>
      <section className="review-work panel" aria-label="任务完成量"><div className="review-section-heading"><h3>{selected ? `${shortDate(selected.date)}的进度` : '这一周推进了'}</h3>{selected ? <button className="review-reset" onClick={() => setSelectedDay(null)}>查看整周</button> : <span>{work.length} 项任务</span>}</div>
        {selected && <p className="review-selected-note">{selected.achieved_count} 项达标 · 专注 {focusDuration(selected.focus_seconds)}{selected.is_rest ? ' · 休息日' : ''}</p>}
        {work.length ? <div className="review-task-table"><div className="review-table-head" aria-hidden="true"><span>任务</span><span>完成量</span><span>达标天数</span></div>{work.map(task => <div className="review-task-row" key={task.task_id}><button aria-label={`查看${task.name}的记录`} onClick={() => onTask(task.task_id)} title={task.name}><BookOpen size={15} /><span>{task.name}</span><ArrowUpRight size={13} /></button><strong>{task.amount}<small>{task.unit}</small></strong><span>{task.achieved_days ? <><Check size={13} />{task.achieved_days} 天</> : '—'}</span></div>)}</div> : <div className="review-work-empty"><Footprints size={22} strokeWidth={1.4} /><p>{selected ? '这一天还没有任务进度' : '这一周，还没有任务记录'}</p></div>}
      </section>
    </>}
  </section>;
}
