"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, BookOpen, Check, ChevronDown, Coffee, History, Maximize, Minimize, Moon, Pause, Play, Settings2, Square, Sun, Timer, Volume2, VolumeX } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useFocusStore } from "@/lib/focus-store";
import { clockText, durationText, phaseLabels, type FocusPhase, type FocusSession, type FocusSettings, type FocusSettlement } from "@/lib/focus-types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { CourseItems } from "./course-items";
import { useFocusFullscreen } from "@/lib/use-focus-fullscreen";
import { useTimerRemaining } from "./focus-provider";
import "./focus.css";
import "./focus-fullscreen.css";

const defaults: FocusSettings = { focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, long_break_interval: 4, auto_start_break: true, rounds_completed: 0 };
const factors: Record<string, number> = { 秒: 1, 分钟: 60, 小时: 3600 };
const settingsSchema = z.object({
  focus_minutes: z.number().int().min(1).max(180), short_break_minutes: z.number().int().min(1).max(60),
  long_break_minutes: z.number().int().min(1).max(120), long_break_interval: z.number().int().min(1).max(12), auto_start_break: z.boolean(),
});
type SettingsForm = z.infer<typeof settingsSchema>;
function FocusSettingsDialog({ open, onClose, settings }: { open: boolean; onClose: () => void; settings: FocusSettings }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<SettingsForm>({ resolver: zodResolver(settingsSchema), defaultValues: settings });
  const busy = useAppStore(state => state.busy);
  const [notification, setNotification] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  useEffect(() => { if (open) { reset(settings); setNotification(localStorage.getItem("pawnsteps-focus-notifications") === "true" && typeof Notification !== "undefined" && Notification.permission === "granted"); } }, [open, reset]);
  async function toggleNotification() {
    if (notification) { localStorage.removeItem("pawnsteps-focus-notifications"); setNotification(false); return; }
    if (typeof Notification === "undefined") { toast("当前浏览器不支持桌面通知，可使用音效提醒"); return; }
    setPermissionBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") { localStorage.setItem("pawnsteps-focus-notifications", "true"); setNotification(true); }
      else toast("未开启通知，可在浏览器的网站设置中调整");
    } catch { toast("通知暂时不可用，可使用音效提醒"); }
    finally { setPermissionBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogContent className="focus-settings"><DialogTitle>专注节奏</DialogTitle><DialogDescription>调整适合你的时间，当前这一轮保持原有时长。</DialogDescription>
    <form onSubmit={handleSubmit(async values => { try { await useFocusStore.getState().write("/settings", values); onClose(); } catch { /* Store reports the failure. */ } })}>
      <div className="focus-settings-grid">{([
        ["focus_minutes", "专注时长", 180, "分钟"], ["short_break_minutes", "短休息", 60, "分钟"],
        ["long_break_minutes", "长休息", 120, "分钟"], ["long_break_interval", "长休息间隔", 12, "轮"],
      ] as const).map(([name, label, max, unit]) => <label key={name}>{label}<div><input className="field" type="number" min={1} max={max} {...register(name, { valueAsNumber: true })} /><span>{unit}</span></div>{errors[name] && <small role="alert">请输入 1–{max} 的整数</small>}</label>)}</div>
      <label className="focus-check"><input type="checkbox" {...register("auto_start_break")} /><span>确认成果后自动开始休息</span></label>
      <div className="focus-notification"><Bell size={17} /><span>桌面提醒<small>网页保持打开时，到点提醒</small></span><Button type="button" size="sm" variant="outline" disabled={permissionBusy} onClick={() => void toggleNotification()}>{notification ? "关闭" : "开启"}</Button></div>
      <Button type="submit" disabled={busy} className="focus-settings-save">保存设置</Button>
    </form>
  </DialogContent></Dialog>;
}

function FocusDial({ phase, duration, remaining, status, round, length, fullscreenControl }: { phase: FocusPhase; duration: number; remaining: number; status?: FocusSession["status"]; round: number; length: number; fullscreenControl: ReactNode }) {
  const fraction = duration ? Math.min(1, Math.max(0, 1 - remaining / duration)) : 0;
  const circumference = 2 * Math.PI * 139;
  const label = status === "paused" ? "已暂停" : status === "completed" ? "这一轮完成了" : status === "ended" ? "本轮已结束" : phaseLabels[phase];
  return <div className={`focus-dial ${phase !== "focus" ? "is-break" : ""} ${status === "completed" ? "is-finished" : ""}`}>
    {fullscreenControl}
    <div className="focus-crown" aria-hidden="true" />
    <div className="focus-dial-face">
      <svg className="focus-dial-marks" viewBox="0 0 340 340" aria-hidden="true">
        <circle cx={170} cy={170} r={139} fill="none" stroke="var(--line)" strokeWidth={5} />
        <circle className="focus-dial-arc" cx={170} cy={170} r={139} fill="none" strokeWidth={5} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)} transform="rotate(-90 170 170)" />
        {Array.from({ length: 60 }, (_, index) => <line key={index} x1={170} y1={index % 5 === 0 ? 47 : 51} x2={170} y2={index % 5 === 0 ? 61 : 57} transform={`rotate(${index * 6} 170 170)`} className={index % 5 === 0 ? "major-tick" : "minor-tick"} strokeWidth={index % 5 === 0 ? 2 : 1} />)}
      </svg>
      <div className="focus-dial-content">
        <span className="focus-dial-label">{phase !== "focus" ? <Coffee size={15} /> : <Timer size={15} />}{label}</span>
        <span className="focus-clock" role="timer" aria-live="off" aria-label={`剩余 ${clockText(remaining)}`}>{clockText(remaining)}</span>
        <span className="focus-dial-caption">{status === "ended" ? `实际专注 ${durationText(duration - remaining)}` : phase === "focus" ? `第 ${round} / ${length} 轮` : "让自己缓一缓"}</span>
        <div className="focus-rounds" aria-label={`当前第 ${round} 轮，共 ${length} 轮`}>{Array.from({ length }, (_, index) => <span key={index} className={index < round ? "filled" : ""} />)}</div>
      </div>
    </div>
  </div>;
}

function FocusConfirmation({ session, fullscreenControl }: { session: FocusSession; fullscreenControl: ReactNode }) {
  const task = useAppStore(state => state.tasks.find(task => task.id === session.task_id));
  const busy = useAppStore(state => state.busy);
  const factor = factors[session.task_unit];
  const measured = factor ? Math.floor(session.elapsed_seconds / factor) : 0;
  const [amount, setAmount] = useState(factor && measured > 0 ? String(measured) : "");
  const [indices, setIndices] = useState<number[]>([]);
  const [picker, setPicker] = useState(false);
  const [pending, setPending] = useState<FocusSettlement | null>(null);
  const pendingRef = useRef<FocusSettlement | null>(null);
  const readonlyIndices = useMemo(() => task?.course_items?.flatMap((item, index) => item.done ? [index] : []) || [], [task?.course_items]);
  const validIndices = indices.filter(index => task?.course_items?.[index] && !readonlyIndices.includes(index));
  const canRecord = session.can_record && !!task && session.elapsed_seconds >= 1;
  const validAmount = Number.isInteger(Number(amount)) && Number(amount) > 0 && Number(amount) <= 1000000 && (!factor || Number(amount) <= measured);
  const canConfirm = canRecord && (session.is_course ? validIndices.length > 0 : validAmount);
  const projected = task?.course_items ? { ...task, course_items: task.course_items.map((item, index) => ({ ...item, done: item.done || indices.includes(index) })) } : null;
  async function settle(record: boolean) {
    const body = pendingRef.current || (record ? { record_progress: true, ...(session.is_course ? { course_indices: validIndices } : { amount: Number(amount) }) } : { record_progress: false });
    pendingRef.current = body; setPending(body);
    try { await useFocusStore.getState().write(`/${session.id}/settle`, body); }
    catch (error) { if (error instanceof ApiError && error.status < 500) { pendingRef.current = null; setPending(null); } }
  }
  return <section className="focus-confirmation" aria-label="确认专注成果">
    <div className="focus-result-fullscreen-control">{fullscreenControl}</div>
    <p className="focus-result-task-name" title={session.task_name}>{session.task_name}</p>
    <div className="focus-section-title"><Check size={18} /><h2>{session.status === "completed" ? "这一轮的成果" : "保存这次专注"}</h2></div>
    <p>实际专注 <strong>{durationText(session.elapsed_seconds)}</strong>{session.status === "ended" && "，未计为完整番茄钟"}。</p>
    {canRecord && <>
      {session.is_course ? <Button variant="outline" disabled={busy || !!pending} onClick={() => setPicker(true)}><BookOpen size={16} />{validIndices.length ? `已选 ${validIndices.length} 节` : "选择完成的课程"}</Button> : <label className="focus-result-label">本轮实际完成<div className="focus-result-input"><input type="number" className="field" min={1} max={factor ? measured : 1000000} step={1} value={amount} disabled={busy || !!pending || !!factor && measured === 0} onChange={event => setAmount(event.target.value)} aria-label="本轮实际完成量" /><span>{session.task_unit}</span></div></label>}
      <p className="focus-helper">{factor ? measured > 0 ? `最多记录 ${measured} ${session.task_unit}，暂停时间已扣除。` : `不足 1 ${session.task_unit}，本轮只保存专注时长。` : "填写实际成果后，才会更新任务进度。"}任务进度记在确认当天。</p>
    </>}
    {!canRecord && <p className="focus-helper">{session.task_id || session.task_name !== "自由专注" ? "任务已完成、不可记录或已变更，本轮保留专注时长。" : "自由专注只记录时长。"}</p>}
    <div className="focus-confirm-actions">{pending ? <Button disabled={busy} onClick={() => void settle(pending.record_progress)}>重试确认</Button> : <>{canRecord && <Button disabled={busy || !canConfirm} onClick={() => void settle(true)}><Check size={16} />记录并确认</Button>}<Button variant={canRecord ? "ghost" : "default"} disabled={busy} onClick={() => void settle(false)}>只保存时长</Button></>}</div>
    <Dialog open={picker && !!projected} onOpenChange={setPicker}><DialogContent className="course-drawer focus-course-picker"><div className="course-drawer-header"><DialogTitle>本轮完成的课程</DialogTitle><DialogDescription>勾选或鼠标框选，已完成的课程不会重复记录。</DialogDescription></div><div className="course-drawer-body">{projected && <CourseItems task={projected} readonlyIndices={readonlyIndices} onSelectionChange={(selected, done) => setIndices(current => done ? [...new Set([...current, ...selected])] : current.filter(index => !selected.includes(index)))} />}</div><div className="course-drawer-footer"><span>已选 {validIndices.length} 节</span><Button onClick={() => setPicker(false)}>确认选择</Button></div></DialogContent></Dialog>
  </section>;
}

export function FocusPanel() {
  const root = useRef<HTMLDivElement>(null);
  const { fullscreen, transitioning, toggle } = useFocusFullscreen(root);
  const dark = useAppStore(state => state.dark), muted = useAppStore(state => state.muted);
  const data = useFocusStore(state => state.data), error = useFocusStore(state => state.error);
  const tasks = useAppStore(state => state.tasks), busy = useAppStore(state => state.busy), timezone = useAppStore(state => state.timezone);
  const [phase, setPhase] = useState<FocusPhase>("focus");
  const [taskId, setTaskId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false), [endOpen, setEndOpen] = useState(false);
  const remaining = useTimerRemaining();
  const settings = data?.settings || defaults, session = data?.active_session;
  const finished = session?.status === "completed" || session?.status === "ended";
  const confirming = !!session && session.phase === "focus" && finished;
  const activePhase = session && (!finished || confirming) ? session.phase : phase;
  const duration = session && (!finished || confirming) ? session.duration_seconds : settings[activePhase === "focus" ? "focus_minutes" : activePhase === "short_break" ? "short_break_minutes" : "long_break_minutes"] * 60;
  const displayRemaining = session && (!finished || confirming) ? remaining : duration;
  const round = session && (!finished || confirming) ? session.cycle_round : settings.rounds_completed % settings.long_break_interval + 1;
  const linkedTask = session ? tasks.find(task => task.id === session.task_id) : tasks.find(task => task.id === taskId);
  useEffect(() => { if (session?.task_id) setTaskId(session.task_id); }, [session?.id, session?.task_id]);
  async function control(action: string) { if (!session) return; try { await useFocusStore.getState().write(`/${session.id}/${action}`); setEndOpen(false); } catch { /* Store reports the failure. */ } }
  async function start() { try { await useFocusStore.getState().start(tasks.some(task => task.id === taskId && !task.is_done) ? taskId : null, activePhase); } catch { /* Store reports the failure. */ } }
  const fullscreenControl = <button key="fullscreen" data-focus-fullscreen-toggle className="icon-button focus-fullscreen-toggle" disabled={transitioning} onClick={() => void toggle()} aria-label={fullscreen ? "退出全屏" : "全屏专注"} aria-pressed={fullscreen} title={fullscreen ? "退出全屏（Esc）" : "全屏专注"}>{fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button>;
  return <div ref={root} className={`focus-page ${fullscreen ? "is-fullscreen" : ""}`} data-focus-state={confirming ? "confirming" : session && !finished ? "active" : "ready"} role={fullscreen ? "dialog" : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? "全屏专注计时" : undefined} tabIndex={fullscreen ? -1 : undefined}>
    <div className="focus-page-toolbar"><p>{fullscreen ? "专注计时" : "一段时间，只做一件事。"}</p><div className="focus-view-actions">
      {fullscreen && <button key="theme" className="icon-button" onClick={() => useAppStore.getState().toggleTheme()} aria-label={dark ? "切换浅色模式" : "切换暗色模式"}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>}
      {fullscreen && <button key="sound" className="icon-button" onClick={() => useAppStore.getState().toggleMuted()} aria-label={muted ? "开启音效" : "静音"} aria-pressed={muted}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>}
      <button key="settings" className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="专注设置" disabled={!data}><Settings2 size={19} /></button>
    </div></div>
    {error && <div className="error-banner" role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void useFocusStore.getState().refresh()}>重新连接</Button></div>}
    <div className={`focus-layout ${confirming ? "is-confirming" : ""}`}>
      <section className="focus-timer-card panel" aria-label="番茄计时器">
        <div className="focus-mobile-task"><label className="sr-only" htmlFor="focus-mobile-task">关联任务</label><select id="focus-mobile-task" className="field" value={session && !finished ? session.task_id || "" : taskId} disabled={!!session && !finished || busy} onChange={event => setTaskId(event.target.value)}><option value="">自由专注</option>{tasks.filter(task => !task.is_done || task.id === session?.task_id).map(task => <option key={task.id} value={task.id}>{task.name}</option>)}</select></div>
        <div className="focus-phase-tabs" role="group" aria-label="计时模式">{(Object.keys(phaseLabels) as FocusPhase[]).map(value => <button key={value} aria-pressed={activePhase === value} disabled={!!session && (!finished || confirming)} className={activePhase === value ? "selected" : ""} onClick={() => setPhase(value)}>{phaseLabels[value]}</button>)}</div>
        <p className="focus-fullscreen-task-name" title={session?.task_name || linkedTask?.name || "自由专注"}>{session?.task_name || linkedTask?.name || "自由专注"}</p>
        <FocusDial fullscreenControl={fullscreenControl} phase={activePhase} duration={duration} remaining={displayRemaining} status={session && (!finished || confirming) ? session.status : undefined} round={round} length={session && (!finished || confirming) ? session.cycle_length : settings.long_break_interval} />
        <div className="focus-main-controls">{confirming ? <span className="focus-awaiting"><Check size={16} />确认成果，收好这一段时间</span> : session && !finished ? <><Button className="focus-primary-control" disabled={busy} onClick={() => void control(session.status === "running" ? "pause" : "resume")}>{session.status === "running" ? <Pause size={17} /> : <Play size={17} />}{session.status === "running" ? "暂停" : session.phase === "focus" ? "继续专注" : "继续休息"}</Button><button className="icon-button focus-stop" disabled={busy} onClick={() => setEndOpen(true)} aria-label={session.phase === "focus" ? "结束本轮" : "跳过休息"} title={session.phase === "focus" ? "结束本轮" : "跳过休息"}><Square size={16} /></button></> : <Button className="focus-primary-control" disabled={busy || !data} onClick={() => void start()}><Play size={17} />{session?.phase !== "focus" && finished ? "开始下一轮" : activePhase === "focus" ? "开始专注" : "开始休息"}</Button>}</div>
        <p className="focus-under-clock">{confirming ? `本轮累计 ${durationText(session.elapsed_seconds)}` : session?.status === "paused" ? "暂停时不累计专注时长" : session && !finished ? session.phase === "focus" ? `正在专注 · ${session.task_name}` : "休息结束后，由你开始下一轮" : "准备好了，就从现在开始"}</p>
      </section>
      <aside className="focus-details">
        {confirming ? <FocusConfirmation key={session.id} session={session} fullscreenControl={fullscreenControl} /> : <section className="focus-task-section"><div className="focus-section-title"><BookOpen size={17} /><h2>这一轮，专注什么</h2></div><label className="sr-only" htmlFor="focus-task">关联任务</label><select id="focus-task" className="field" value={session && !finished ? session.task_id || "" : taskId} disabled={!!session && !finished || busy} onChange={event => setTaskId(event.target.value)}><option value="">自由专注</option>{tasks.filter(task => !task.is_done || task.id === session?.task_id).map(task => <option key={task.id} value={task.id}>{task.name}</option>)}</select><p className="focus-helper">{linkedTask ? `${linkedTask.course_items ? "已学" : "已完成"} ${linkedTask.progress} / ${linkedTask.target} ${linkedTask.course_items ? "节" : linkedTask.daily_quota > 0 && !linkedTask.daily_plan ? "天" : linkedTask.unit} · 结束时确认实际成果` : "阅读、思考或整理，留一段安静的时间。"}</p></section>}
        <section className="focus-today"><div className="focus-section-title"><Timer size={17} /><h2>今日专注</h2></div><div className="focus-today-values"><div><strong>{Math.floor((data?.summary.today_seconds || 0) / 60)}<small>分钟</small></strong><span>实际专注时长</span></div><div><strong>{data?.summary.today_pomodoros || 0}<small>轮</small></strong><span>完整番茄钟</span></div></div><p className="focus-helper">每 {settings.long_break_interval} 轮长休息 · 累计完成 {data?.summary.total_pomodoros || 0} 轮</p></section>
        <details className="focus-history"><summary><History size={17} /><span>最近专注</span><ChevronDown size={15} /></summary><div>{data?.recent_sessions.length ? data.recent_sessions.map(item => <div className="focus-history-row" key={item.id}><span><strong>{item.task_name}</strong><small>{new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.started_at))} · {item.status === "completed" ? "完整一轮" : "提前结束"}{!item.settled_at ? " · 待确认" : ""}</small></span><span>{durationText(item.elapsed_seconds)}</span></div>) : <p className="focus-helper">完成第一轮后，记录会留在这里。</p>}</div></details>
      </aside>
    </div>
    <FocusSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} />
    <Dialog open={endOpen} onOpenChange={setEndOpen}><DialogContent><DialogTitle>{session?.phase === "focus" ? "结束这一轮？" : "结束休息？"}</DialogTitle><DialogDescription>{session?.phase === "focus" ? "已专注的时间会保留，接下来可以确认实际成果。本轮不足完整时长，不计为一个番茄钟。" : "休息时间不计入专注统计。准备好后，可以开始下一轮。"}</DialogDescription><div className="focus-end-actions"><Button variant="secondary" onClick={() => setEndOpen(false)}>继续{session?.phase === "focus" ? "专注" : "休息"}</Button><Button disabled={busy} onClick={() => void control("end")}>确认结束</Button></div></DialogContent></Dialog>
  </div>;
}
