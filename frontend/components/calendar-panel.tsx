"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Circle, ChevronLeft, ChevronRight, Flame, List, Moon, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { HistoryEntry, HistoryResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import "./collections.css";

function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function dateLabel(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" }); }
type ActivityStatus = 'recorded' | 'partial' | 'met' | 'exceeded';
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

export function CalendarPanel() {
  const tasks = useAppStore(state => state.tasks);
  const streak = useAppStore(state => state.stats.streak);
  const serverToday = useAppStore(state => state.today);
  const currentDay = serverToday || dateKey(new Date());
  const previousToday = useRef(currentDay);
  const [month, setMonth] = useState(() => { const date = new Date(`${currentDay}T12:00:00`); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState(currentDay);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [restDates, setRestDates] = useState<string[]>([]);
  const restDays = useMemo(() => new Set(restDates), [restDates]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const monthKey = dateKey(month).slice(0, 7);

  useEffect(() => {
    if (previousToday.current !== currentDay) {
      if (selectedDay === previousToday.current) {
        setSelectedDay(currentDay);
        const date = new Date(`${currentDay}T12:00:00`);
        setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      }
      previousToday.current = currentDay;
    }
  }, [currentDay, selectedDay]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    api<HistoryResponse>(`/history?month=${monthKey}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setHistory(data.history); setRestDates(data.rest_dates || []); } })
      .catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "打卡记录暂时无法加载"); setHistory([]); setRestDates([]); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [monthKey, tasks, retry]);

  const byDay = useMemo(() => {
    const result: Record<string, HistoryEntry[]> = {};
    for (const entry of history) {
      if (entry.amount > 0 && entry.date.startsWith(monthKey)) (result[entry.date] ||= []).push(entry);
    }
    return result;
  }, [history, monthKey]);
  const days = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (start.getDay() + 6) % 7;
    const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cellCount = Math.ceil((offset + monthDays) / 7) * 7;
    start.setDate(start.getDate() - offset);
    return Array.from({ length: cellCount }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [month]);
  const recordedDays = Object.keys(byDay).sort().reverse();
  const selectedEntries = byDay[selectedDay] || [];
  function moveMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next); setSelectedDay(dateKey(next));
  }
  function chooseDay(day: Date) {
    setSelectedDay(dateKey(day));
    if (day.getMonth() !== month.getMonth() || day.getFullYear() !== month.getFullYear()) setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  }
  function goToday() {
    const now = new Date(`${currentDay}T12:00:00`); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDay(currentDay);
  }

  return <section className="collections-panel calendar-panel" aria-label="打卡记录">
    <div className="calendar-toolbar">
      <div className="calendar-month-nav"><button className="icon-button" type="button" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={20} /></button><h2>{month.getFullYear()} 年 {month.getMonth() + 1} 月</h2><button className="icon-button" type="button" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={20} /></button><Button variant="ghost" size="sm" onClick={goToday}>今天</Button></div>
      <div className="calendar-view-toggle" role="group" aria-label="打卡记录视图"><button type="button" aria-label="月历" aria-pressed={view === "calendar"} onClick={() => setView("calendar")}><CalendarDays size={16} /><span>月历</span></button><button type="button" aria-label="列表" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={17} /><span>列表</span></button></div>
    </div>
    {error && <div className="calendar-error" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} />重试</Button></div>}
    <div className="calendar-summary-row"><div className="calendar-month-summary" aria-live="polite">{loading ? "正在加载记录" : <><span>本月 <strong>{recordedDays.length}</strong> 天有进度</span><span>共 <strong>{Object.values(byDay).reduce((sum, entries) => sum + entries.length, 0)}</strong> 项任务记录</span></>}</div><div className="calendar-streak"><Flame size={16} aria-hidden="true" /><span>连续 <strong>{streak}</strong> 天</span></div></div>
    {view === "calendar" ? <div className="calendar-layout" data-weeks={days.length / 7} aria-busy={loading}>
      <div className={`calendar-sheet panel ${loading ? "calendar-loading" : ""}`}>
        <table className="calendar-table"><caption className="sr-only">{month.getFullYear()} 年 {month.getMonth() + 1} 月打卡记录</caption><thead><tr>{weekDays.map(day => <th scope="col" key={day}>周{day}</th>)}</tr></thead><tbody>
          {Array.from({ length: days.length / 7 }, (_, week) => <tr key={week}>{days.slice(week * 7, week * 7 + 7).map(day => {
            const key = dateKey(day); const entries = byDay[key] || []; const outside = day.getMonth() !== month.getMonth(); const status = dayStatus(entries);
            return <td key={key}><button type="button" className={`calendar-day ${outside ? "outside-month" : ""} ${key === currentDay ? "is-today" : ""} ${key === selectedDay ? "is-selected" : ""} ${entries.length ? `has-records activity-${status}` : restDays.has(key) ? "is-rest" : ""}`} aria-label={`${dateLabel(key)}，${entries.length ? `${entries.length} 项任务有进度，${statusLabels[status]}` : restDays.has(key) ? "休息日" : "暂无任务进度"}`} aria-pressed={key === selectedDay} aria-current={key === currentDay ? "date" : undefined} onClick={() => chooseDay(day)}><span className="calendar-day-number">{day.getDate()}</span><span className="calendar-day-dots" aria-hidden="true">{entries.length > 0 ? <i /> : restDays.has(key) ? <Moon size={11} /> : null}</span></button></td>;
          })}</tr>)}
        </tbody></table>
        <div className="calendar-legend"><span><i className="activity-partial" />有进度</span><span><i />已达标</span><span><i className="activity-exceeded" />超量完成</span><span>无圆点：未记录</span></div>
      </div>
      <aside className="calendar-day-detail panel"><div className="calendar-detail-heading"><h3>{dateLabel(selectedDay)}</h3></div>{loading ? <p className="calendar-detail-empty muted" role="status">正在加载记录</p> : selectedEntries.length ? <ul className="calendar-completed-list">{selectedEntries.map(entry => <ActivityRow key={entry.task_id} entry={entry} />)}</ul> : <div className="calendar-detail-empty"><CalendarDays size={24} strokeWidth={1.2} /><p>{restDays.has(selectedDay) ? "这一天是休息日，不计漏打卡" : "这一天还没有任务进度"}</p></div>}</aside>
    </div> : <div className="calendar-list-panel panel" aria-busy={loading}>{loading ? <p className="calendar-detail-empty muted" role="status">正在加载记录</p> : recordedDays.length ? recordedDays.map(day => <section className="calendar-list-day" key={day}><button type="button" className="calendar-list-date" onClick={() => { setSelectedDay(day); setView("calendar"); }}><strong>{new Date(`${day}T12:00:00`).getDate()}</strong><span>{new Date(`${day}T12:00:00`).toLocaleDateString("zh-CN", { weekday: "long" })}</span><small>{byDay[day].length} 项任务</small></button><ul className="calendar-completed-list">{byDay[day].map(entry => <ActivityRow key={entry.task_id} entry={entry} />)}</ul></section>) : <div className="calendar-detail-empty"><CalendarDays size={38} strokeWidth={1.2} /><h3>这个月的故事，等你来写</h3><p className="muted">记录一次任务进度，就会出现在这里。</p></div>}</div>}
  </section>;
}
