"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CalendarRange, ChartNoAxesCombined, Check, Circle, ChevronLeft, ChevronRight, Flame, List, Moon, RefreshCw } from "lucide-react";
import { api, ownerIdentity } from "@/lib/api";
import { shiftDate, shortDate, weekStart } from "@/lib/review-types";
import { useAppStore } from "@/lib/store";
import type { HistoryEntry, HistoryResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import "./collections.css";
import "./calendar-week.css";

function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function calendarDate(value: string) { return new Date(`${value}T12:00:00Z`); }
function dateLabel(value: string) { return calendarDate(value).toLocaleDateString("zh-CN", { timeZone: "UTC", month: "long", day: "numeric", weekday: "long" }); }
function shiftMonth(value: string, offset: number) {
  const date = calendarDate(`${value}-01`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
function weekLabel(first: string, last: string) {
  const year = first.slice(0, 4), endYear = last.slice(0, 4);
  return `${year}年 ${shortDate(first)} — ${year === endYear ? '' : `${endYear}年 `}${shortDate(last)}`;
}

type ActivityStatus = 'recorded' | 'partial' | 'met' | 'exceeded';
type CalendarView = 'calendar' | 'week' | 'list';
interface HistoryState { key: string; data: HistoryResponse | null; loading: boolean; error: string }
function activityStatus(entry: HistoryEntry): ActivityStatus {
  if (!entry.quota || entry.quota <= 0) return 'recorded';
  if (entry.amount < entry.quota) return 'partial';
  return entry.amount > entry.quota ? 'exceeded' : 'met';
}
function dayStatus(entries: HistoryEntry[]): ActivityStatus {
  const statuses = entries.map(activityStatus);
  return statuses.includes('exceeded') ? 'exceeded' : statuses.includes('met') ? 'met' : statuses.includes('partial') ? 'partial' : 'recorded';
}
function activityLabel(entry: HistoryEntry) {
  if (!entry.quota || entry.quota <= 0) return `完成 ${entry.amount} ${entry.unit}`;
  const difference = entry.amount - entry.quota;
  const status = difference < 0 ? `未达标，还差 ${-difference} ${entry.unit}` : difference > 0 ? `超量完成 +${difference} ${entry.unit}` : '已达标';
  return `完成 ${entry.amount} / ${entry.quota} ${entry.unit} · ${status}`;
}
const statusLabels = { recorded: '有进度', partial: '未达标', met: '已达标', exceeded: '超量完成' };
const weekDays = ["一", "二", "三", "四", "五", "六", "日"];

function ActivityRow({ entry }: { entry: HistoryEntry }) {
  const status = activityStatus(entry);
  const hasMinimum = Boolean(entry.quota && entry.quota > 0);
  const quantity = hasMinimum ? `${entry.amount} / ${entry.quota} ${entry.unit}` : `${entry.amount} ${entry.unit}`;
  const detail = status === 'partial' ? `还差 ${entry.quota! - entry.amount} ${entry.unit}`
    : status === 'exceeded' ? `超量完成 +${entry.amount - entry.quota!}`
    : status === 'met' ? '已达标' : '已记录';
  return <li>
    <span className={`calendar-complete-check activity-${status}`} aria-hidden="true">{status === 'met' || status === 'exceeded' ? <Check size={14} /> : <Circle size={7} fill="currentColor" />}</span>
    <strong className="calendar-entry-name" title={entry.task_name}>{entry.task_name}</strong>
    <div className="calendar-entry-progress" title={activityLabel(entry)}>
      <span className="sr-only">{activityLabel(entry)}</span>
      <div aria-hidden="true"><span className="calendar-entry-quantity">{quantity}</span><span className={`calendar-entry-status activity-${status}`}>{detail}</span></div>
    </div>
  </li>;
}

function ActivityLegend() {
  return <div className="calendar-legend"><span><i className="activity-partial" />有进度 / 未达标</span><span><i />已达标</span><span><i className="activity-exceeded" />超量完成</span><span>无圆点：未记录</span></div>;
}

export function CalendarPanel({ onReview }: { onReview: () => void }) {
  const tasks = useAppStore(state => state.tasks);
  const streak = useAppStore(state => state.stats.streak);
  const serverToday = useAppStore(state => state.today);
  const userId = useAppStore(state => state.user?.id);
  const [, setIdentityRevision] = useState(0);
  const currentDay = serverToday || dateKey(new Date());
  const owner = typeof window === 'undefined' ? '' : ownerIdentity();
  const previousToday = useRef(currentDay);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const [monthKey, setMonthKey] = useState(() => currentDay.slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(currentDay);
  const [view, setView] = useState<CalendarView>('calendar');
  const [request, setRequest] = useState<HistoryState>({ key: '', data: null, loading: true, error: '' });
  const [retry, setRetry] = useState(0);
  const firstWeekDay = weekStart(selectedDay), lastWeekDay = shiftDate(firstWeekDay, 6);
  const periodQuery = view === 'week' ? `week_of=${firstWeekDay}` : `month=${monthKey}`;
  const requestKey = `${owner}:${periodQuery}`;
  const shown = request.key === requestKey ? request : null;
  const loading = !shown || shown.loading;
  const error = shown?.error || '';
  const history = shown?.data?.history;
  const restDays = useMemo(() => new Set(shown?.data?.rest_dates || []), [shown?.data]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'pawnsteps-token' || event.key === 'pawnsteps-guest-id') setIdentityRevision(value => value + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (previousToday.current !== currentDay) {
      if (selectedDay === previousToday.current) {
        setSelectedDay(currentDay); setMonthKey(currentDay.slice(0, 7));
      }
      previousToday.current = currentDay;
    }
  }, [currentDay, selectedDay]);

  useEffect(() => {
    const controller = new AbortController();
    const capturedOwner = owner;
    setRequest({ key: requestKey, data: null, loading: true, error: '' });
    api<HistoryResponse>(`/history?${periodQuery}`, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted && capturedOwner === ownerIdentity()) setRequest({ key: requestKey, data, loading: false, error: '' });
      })
      .catch(reason => {
        if (!controller.signal.aborted && capturedOwner === ownerIdentity()) setRequest({ key: requestKey, data: null, loading: false, error: reason instanceof Error ? reason.message : "打卡记录暂时无法加载" });
      });
    return () => controller.abort();
  }, [requestKey, periodQuery, owner, currentDay, tasks, userId, retry]);

  const byDay = useMemo(() => {
    const result: Record<string, HistoryEntry[]> = {};
    for (const entry of history || []) {
      const inPeriod = view === 'week' ? firstWeekDay <= entry.date && entry.date <= lastWeekDay : entry.date.startsWith(monthKey);
      if (entry.amount > 0 && inPeriod) (result[entry.date] ||= []).push(entry);
    }
    return result;
  }, [history, view, firstWeekDay, lastWeekDay, monthKey]);
  const days = useMemo(() => {
    const first = `${monthKey}-01`, start = calendarDate(first);
    const offset = (start.getUTCDay() + 6) % 7;
    const end = calendarDate(first); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    const cellCount = Math.ceil((offset + end.getUTCDate()) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => shiftDate(first, index - offset));
  }, [monthKey]);
  const weekDates = Array.from({ length: 7 }, (_, index) => shiftDate(firstWeekDay, index));
  const recordedDays = Object.keys(byDay).sort().reverse();
  const selectedEntries = byDay[selectedDay] || [];
  const year = Number(monthKey.slice(0, 4)), month = Number(monthKey.slice(5, 7));

  function movePeriod(offset: number) {
    if (view === 'week') setSelectedDay(shiftDate(selectedDay, offset * 7));
    else { const next = shiftMonth(monthKey, offset); setMonthKey(next); setSelectedDay(`${next}-01`); }
  }
  function chooseDay(day: string) {
    setSelectedDay(day);
    if (view !== 'week') setMonthKey(day.slice(0, 7));
  }
  function changeView(next: CalendarView) {
    if (next !== 'week') setMonthKey(selectedDay.slice(0, 7));
    setView(next);
  }
  function goToday() { setMonthKey(currentDay.slice(0, 7)); setSelectedDay(currentDay); }
  function emptyDayLabel(day: string) { return restDays.has(day) ? '休息日' : day > currentDay ? '尚未到来' : '未记录'; }
  function dayAriaLabel(day: string, entries: HistoryEntry[]) {
    return `${dateLabel(day)}，${loading ? '正在加载记录' : error ? '记录暂未加载' : entries.length ? `${entries.length} 项任务有进度，${statusLabels[dayStatus(entries)]}` : restDays.has(day) ? '休息日' : day > currentDay ? '尚未到来' : '暂无任务进度'}`;
  }
  function showAll(day: string) {
    chooseDay(day);
    requestAnimationFrame(() => detailHeading.current?.focus());
  }
  const detailBody = loading ? <p className="calendar-detail-empty muted" role="status">正在加载记录</p>
    : error ? <p className="calendar-detail-empty muted">记录暂未加载，请重试</p>
    : selectedEntries.length ? <ul className="calendar-completed-list">{selectedEntries.map(entry => <ActivityRow key={entry.task_id} entry={entry} />)}</ul>
    : <div className="calendar-detail-empty"><CalendarDays size={24} strokeWidth={1.2} /><p>{restDays.has(selectedDay) ? "这一天是休息日，不计漏打卡" : selectedDay > currentDay ? '这一天尚未到来' : "这一天还没有任务进度"}</p></div>;

  return <section className={`collections-panel calendar-panel ${view === 'week' ? 'is-week-view' : ''}`} aria-label="打卡记录">
    <div className="calendar-toolbar">
      <div className={`calendar-month-nav ${view === 'week' ? 'calendar-week-nav' : ''}`}>
        <button className="icon-button" type="button" aria-label={view === 'week' ? '上一周' : '上个月'} onClick={() => movePeriod(-1)}><ChevronLeft size={20} /></button>
        <h2 title={view === 'week' ? weekLabel(firstWeekDay, lastWeekDay) : undefined}>{view === 'week' ? <><span className="calendar-week-year">{firstWeekDay.slice(0, 4)}{firstWeekDay.slice(0, 4) !== lastWeekDay.slice(0, 4) ? ` / ${lastWeekDay.slice(0, 4)}` : ''} 年</span><span>{shortDate(firstWeekDay)} — {shortDate(lastWeekDay)}</span></> : `${year} 年 ${month} 月`}</h2>
        <button className="icon-button" type="button" aria-label={view === 'week' ? '下一周' : '下个月'} onClick={() => movePeriod(1)}><ChevronRight size={20} /></button>
        <Button variant="ghost" size="sm" onClick={goToday}>{view === 'week' ? '本周' : '今天'}</Button>
      </div>
      <div className="calendar-view-toggle" role="group" aria-label="打卡记录视图">
        <button type="button" aria-label="月历" aria-pressed={view === 'calendar'} onClick={() => changeView('calendar')}><CalendarDays size={16} /><span>月历</span></button>
        <button type="button" aria-label="周" aria-pressed={view === 'week'} onClick={() => changeView('week')}><CalendarRange size={16} /><span>周</span></button>
        <button type="button" aria-label="列表" aria-pressed={view === 'list'} onClick={() => changeView('list')}><List size={17} /><span>列表</span></button>
        <button type="button" aria-label="每周回顾" onClick={onReview}><ChartNoAxesCombined size={17} /><span>回顾</span></button>
      </div>
    </div>
    {error && <div className="calendar-error" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} />重试</Button></div>}
    <div className="calendar-summary-row"><div className="calendar-month-summary" aria-live="polite">{loading ? "正在加载记录" : error ? '记录暂时不可用' : <><span>{view === 'week' ? '本周' : '本月'} <strong>{recordedDays.length}</strong> 天有进度</span><span>共 <strong>{Object.values(byDay).reduce((sum, entries) => sum + entries.length, 0)}</strong> 项记录</span></>}</div><div className="calendar-streak"><Flame size={16} aria-hidden="true" /><span>连续 <strong>{streak}</strong> 天</span></div></div>
    {view === 'week' ? <div className="calendar-week-layout" aria-busy={loading}>
      <div className="calendar-week-grid" role="group" aria-label="一周打卡记录">
        {weekDates.map((day, index) => {
          const entries = byDay[day] || [], status = dayStatus(entries);
          return <section key={day} data-date={day} className={`calendar-week-day ${day === currentDay ? 'is-today' : ''} ${day === selectedDay ? 'is-selected' : ''} ${day > currentDay ? 'is-future' : ''} ${entries.length ? `has-records activity-${status}` : restDays.has(day) ? 'is-rest' : ''}`}>
            <button type="button" className="calendar-week-date" aria-label={dayAriaLabel(day, entries)} aria-pressed={day === selectedDay} aria-current={day === currentDay ? 'date' : undefined} onClick={() => chooseDay(day)}>
              <span>周{weekDays[index]}</span><strong>{calendarDate(day).getUTCMonth() + 1}/{calendarDate(day).getUTCDate()}</strong>
              <span className="calendar-day-dots" aria-hidden="true">{entries.length ? <i /> : restDays.has(day) ? <Moon size={11} /> : null}</span>
            </button>
            <div className="calendar-week-preview">
              <p className="calendar-week-day-summary">{loading ? '加载中' : error ? '暂未加载' : entries.length ? `${entries.length} 项记录` : emptyDayLabel(day)}</p>
              {entries.length > 0 && <ul className="calendar-week-entries">{entries.slice(0, 3).map(entry => <li key={entry.task_id} className={`activity-${activityStatus(entry)}`}><strong title={entry.task_name}>{entry.task_name}</strong><div className="calendar-week-preview-progress"><span>{entry.amount}{entry.quota && entry.quota > 0 ? ` / ${entry.quota}` : ''} {entry.unit}</span><small>{statusLabels[activityStatus(entry)]}{activityStatus(entry) === 'exceeded' ? ` +${entry.amount - entry.quota!}` : ''}</small></div></li>)}</ul>}
              {entries.length > 3 && <button type="button" className="calendar-week-more" onClick={() => showAll(day)}>查看全部 {entries.length} 项</button>}
            </div>
          </section>;
        })}
      </div>
      <ActivityLegend />
      <aside className="calendar-week-detail calendar-day-detail panel"><div className="calendar-detail-heading"><h3 ref={detailHeading} tabIndex={-1}>{dateLabel(selectedDay)}</h3><span>{selectedEntries.length ? `${selectedEntries.length} 项记录` : ''}</span></div>{detailBody}</aside>
    </div> : view === 'calendar' ? <div className="calendar-layout" data-weeks={days.length / 7} aria-busy={loading}>
      <div className={`calendar-sheet panel ${loading ? "calendar-loading" : ""}`}>
        <table className="calendar-table"><caption className="sr-only">{year} 年 {month} 月打卡记录</caption><thead><tr>{weekDays.map(day => <th scope="col" key={day}>周{day}</th>)}</tr></thead><tbody>
          {Array.from({ length: days.length / 7 }, (_, week) => <tr key={week}>{days.slice(week * 7, week * 7 + 7).map(day => {
            const entries = byDay[day] || [], outside = !day.startsWith(monthKey), status = dayStatus(entries);
            return <td key={day}><button type="button" className={`calendar-day ${outside ? "outside-month" : ""} ${day === currentDay ? "is-today" : ""} ${day === selectedDay ? "is-selected" : ""} ${entries.length ? `has-records activity-${status}` : restDays.has(day) ? "is-rest" : ""}`} aria-label={dayAriaLabel(day, entries)} aria-pressed={day === selectedDay} aria-current={day === currentDay ? "date" : undefined} onClick={() => chooseDay(day)}><span className="calendar-day-number">{calendarDate(day).getUTCDate()}</span><span className="calendar-day-dots" aria-hidden="true">{entries.length > 0 ? <i /> : restDays.has(day) ? <Moon size={11} /> : null}</span></button></td>;
          })}</tr>)}
        </tbody></table>
        <ActivityLegend />
      </div>
      <aside className="calendar-day-detail panel"><div className="calendar-detail-heading"><h3>{dateLabel(selectedDay)}</h3></div>{detailBody}</aside>
    </div> : <div className="calendar-list-panel panel" aria-busy={loading}>{loading ? <p className="calendar-detail-empty muted" role="status">正在加载记录</p> : error ? <p className="calendar-detail-empty muted">记录暂未加载，请重试</p> : recordedDays.length ? recordedDays.map(day => <section className="calendar-list-day" key={day}><button type="button" className="calendar-list-date" onClick={() => { chooseDay(day); changeView('calendar'); }}><strong>{calendarDate(day).getUTCDate()}</strong><span>{calendarDate(day).toLocaleDateString("zh-CN", { timeZone: 'UTC', weekday: "long" })}</span><small>{byDay[day].length} 项任务</small></button><ul className="calendar-completed-list">{byDay[day].map(entry => <ActivityRow key={entry.task_id} entry={entry} />)}</ul></section>) : <div className="calendar-detail-empty"><CalendarDays size={38} strokeWidth={1.2} /><h3>这个月的故事，等你来写</h3><p className="muted">记录一次任务进度，就会出现在这里。</p></div>}</div>}
  </section>;
}
