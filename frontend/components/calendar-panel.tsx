"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Flame, List, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { HistoryEntry, HistoryResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import "./collections.css";

function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function dateLabel(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" }); }
const weekDays = ["一", "二", "三", "四", "五", "六", "日"];

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
      .then(data => { if (!controller.signal.aborted) setHistory(data.history); })
      .catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "打卡记录暂时无法加载"); setHistory([]); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [monthKey, tasks, retry]);

  const byDay = useMemo(() => {
    const result: Record<string, HistoryEntry[]> = {};
    for (const entry of history) {
      if (entry.completed && entry.date.startsWith(monthKey)) (result[entry.date] ||= []).push(entry);
    }
    return result;
  }, [history, monthKey]);
  const days = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
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

  return <section className="collections-panel" aria-labelledby="calendar-heading">
    <header className="collections-heading"><div><p id="calendar-heading" className="collections-intro">认真走过的日子，都留在这里。</p><p className="muted">回看每天的打卡记录，看见自己的积累。</p></div><div className="calendar-streak"><Flame size={20} /><strong>{streak}</strong><span>天连续打卡</span></div></header>
    <div className="calendar-toolbar">
      <div className="calendar-month-nav"><button className="icon-button" type="button" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={20} /></button><h2>{month.getFullYear()} 年 {month.getMonth() + 1} 月</h2><button className="icon-button" type="button" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={20} /></button><Button variant="ghost" size="sm" onClick={goToday}>今天</Button></div>
      <div className="calendar-view-toggle" role="group" aria-label="打卡记录视图"><button type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")}><CalendarDays size={16} /><span>月历</span></button><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={17} /><span>列表</span></button></div>
    </div>
    {error && <div className="calendar-error" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} />重试</Button></div>}
    <div className="calendar-month-summary" aria-live="polite">{loading ? "正在翻阅这个月的记录" : <><strong>{recordedDays.length}</strong> 天留下足迹<span>共完成 {Object.values(byDay).reduce((sum, entries) => sum + entries.length, 0)} 次每日打卡</span></>}</div>
    {view === "calendar" ? <div className="calendar-layout" aria-busy={loading}>
      <div className={`calendar-sheet panel ${loading ? "calendar-loading" : ""}`}>
        <table className="calendar-table"><caption className="sr-only">{month.getFullYear()} 年 {month.getMonth() + 1} 月打卡记录</caption><thead><tr>{weekDays.map(day => <th scope="col" key={day}>周{day}</th>)}</tr></thead><tbody>
          {Array.from({ length: 6 }, (_, week) => <tr key={week}>{days.slice(week * 7, week * 7 + 7).map(day => {
            const key = dateKey(day); const entries = byDay[key] || []; const outside = day.getMonth() !== month.getMonth();
            return <td key={key}><button type="button" className={`calendar-day ${outside ? "outside-month" : ""} ${key === currentDay ? "is-today" : ""} ${key === selectedDay ? "is-selected" : ""} ${entries.length ? "has-records" : ""}`} aria-label={`${dateLabel(key)}，${entries.length ? `完成 ${entries.length} 项打卡` : "暂无打卡记录"}`} aria-pressed={key === selectedDay} aria-current={key === currentDay ? "date" : undefined} onClick={() => chooseDay(day)}><span className="calendar-day-number">{day.getDate()}</span><span className="calendar-day-dots" aria-hidden="true">{entries.slice(0, 3).map(entry => <i key={entry.task_id} />)}{entries.length > 3 && <small>+</small>}</span></button></td>;
          })}</tr>)}
        </tbody></table>
        <div className="calendar-legend"><span><i />有完成的每日打卡</span><span>选择日期，查看当天的记录</span></div>
      </div>
      <aside className="calendar-day-detail panel"><div className="calendar-detail-heading"><p className="muted">这一天的积累</p><h3>{dateLabel(selectedDay)}</h3></div>{loading ? <p className="calendar-detail-empty muted" role="status">正在加载记录</p> : selectedEntries.length ? <ul className="calendar-completed-list">{selectedEntries.map(entry => <li key={entry.task_id}><span className="calendar-complete-check"><Check size={15} /></span><div><strong>{entry.task_name}</strong><span>当日目标已达成</span></div></li>)}</ul> : <div className="calendar-detail-empty"><CalendarDays size={32} strokeWidth={1.2} /><p>这一天还没有打卡记录</p><span className="muted">完成每日任务后，足迹就会留在这里。</span></div>}</aside>
    </div> : <div className="calendar-list-panel panel" aria-busy={loading}>{loading ? <p className="calendar-detail-empty muted" role="status">正在加载记录</p> : recordedDays.length ? recordedDays.map(day => <section className="calendar-list-day" key={day}><button type="button" className="calendar-list-date" onClick={() => { setSelectedDay(day); setView("calendar"); }}><strong>{new Date(`${day}T12:00:00`).getDate()}</strong><span>{new Date(`${day}T12:00:00`).toLocaleDateString("zh-CN", { weekday: "long" })}</span><small>{byDay[day].length} 项打卡</small></button><ul className="calendar-completed-list">{byDay[day].map(entry => <li key={entry.task_id}><span className="calendar-complete-check"><Check size={15} /></span><strong>{entry.task_name}</strong></li>)}</ul></section>) : <div className="calendar-detail-empty"><CalendarDays size={38} strokeWidth={1.2} /><h3>这个月的故事，等你来写</h3><p className="muted">完成一次每日打卡，就会出现在这里。</p></div>}</div>}
  </section>;
}
