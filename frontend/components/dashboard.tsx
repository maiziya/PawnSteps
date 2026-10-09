"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { ArrowRight, BookOpen, CalendarDays, ChartNoAxesCombined, Check, ChevronDown, CircleHelp, Flag, Footprints, Gift, LayoutDashboard, Moon, Plus, RefreshCw, Search, Sun, TrendingUp, Timer, UserRound, Volume2, VolumeX, X } from "lucide-react";
import { Toaster } from "sonner";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import { primeAudio } from "@/lib/audio";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TaskCard } from "@/components/task-card";
import { TaskForm, type TaskKind } from "@/components/task-form";
import { CourseItems } from "@/components/course-items";
import { ProgressRecords } from "@/components/progress-records";
import { AccountPanel } from "@/components/account-panel";
import { RewardsPanel } from "@/components/rewards-panel";
import { CalendarPanel } from "@/components/calendar-panel";
import { ReviewPanel } from "./review-panel";
import { FocusPanel } from "./focus-panel";
import { FocusProvider, FocusMini, FocusNavLabel } from "./focus-provider";
import { useFocusStore } from "@/lib/focus-store";
import "./workspace.css";

const navigation = [
  { id: "tasks", label: "我的任务", title: "我的任务", icon: LayoutDashboard },
  { id: "focus", label: "专注计时", title: "专注计时", icon: Timer },
  { id: "calendar", label: "打卡日历", title: "打卡日历", icon: CalendarDays },
  { id: "review", label: "每周回顾", title: "每周回顾", icon: ChartNoAxesCombined },
  { id: "rewards", label: "心愿奖励", title: "心愿奖励", icon: Gift },
  { id: "account", label: "个人中心", title: "个人中心", icon: UserRound },
] as const;
type View = typeof navigation[number]["id"];

export function Dashboard() {
  const { tasks, rewards, stats, user, timezone, loading, busy, error, dark, muted, unlocked, quickFeedback, completionUndo, initialize, refresh, mutate, undoCompletion, toggleTheme, toggleMuted, dismissUnlock } = useAppStore();
  const [view, setView] = useState<View>("tasks");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const pendingOrderRef = useRef<string[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [initialKind, setInitialKind] = useState<TaskKind>("normal");
  const [editing, setEditing] = useState<Task | null>(null);
  const [help, setHelp] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showRest, setShowRest] = useState(false);
  const [dateLabel, setDateLabel] = useState("");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [recordTaskId, setRecordTaskId] = useState<string | null>(null);
  const courseOpener = useRef<HTMLElement | null>(null);
  const openedCourseId = useRef<string | null>(null);
  const completedToggle = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const previousQuickHolds = useRef<Set<string>>(new Set());
  const searchInput = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    void initialize();
    const fromHash = () => { const next = location.hash.slice(1); if (navigation.some(item => item.id === next)) setView(next as View); };
    fromHash(); window.addEventListener("hashchange", fromHash);
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    document.addEventListener("pointerdown", primeAudio);
    document.addEventListener("keydown", primeAudio);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", fromHash);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("pointerdown", primeAudio);
      document.removeEventListener("keydown", primeAudio);
    };
  }, [initialize, refresh]);

  useEffect(() => {
    setDateLabel(new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "long", day: "numeric", weekday: "long" }).format(new Date()));
  }, [timezone, stats]);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  useEffect(() => { if (query.trim()) setShowRest(true); }, [query]);

  const hasTasks = tasks.length > 0;
  const visible = tasks.filter(task => task.name.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || (filter === "daily" && (task.daily_quota > 0 || task.daily_minimum > 0 || task.daily_plan !== null)) || (filter === "course" && task.course_items !== null) || (filter === "done" && task.is_done)));
  const quickHolds = new Set(tasks.filter(task => {
    const feedback = quickFeedback[task.id];
    return filter !== "done" && task.is_done && feedback && feedback.phase !== "failed" && (feedback.keepVisible || (!feedback.wasComplete && feedback.previousProgress < task.target));
  }).map(task => task.id));
  const quickFeedbackVisible = Object.values(quickFeedback).some(feedback => feedback.phase !== "failed");
  const optimisticPositions = new Map((pendingOrder || []).map((id, index) => [id, index]));
  const isRest = (task: Task) => !task.is_done && task.schedule.mode !== 'daily' && !task.is_scheduled_today && !task.daily_done && task.today_amount === 0;
  const resting = visible.filter(isRest).sort((a, b) => (optimisticPositions.get(a.id) ?? a.position) - (optimisticPositions.get(b.id) ?? b.position) || a.created_at.localeCompare(b.created_at));
  const restExpanded = showRest;
  const active = visible.filter(task => (!task.is_done || quickHolds.has(task.id)) && !isRest(task)).sort((a, b) => (optimisticPositions.get(a.id) ?? a.position) - (optimisticPositions.get(b.id) ?? b.position) || a.created_at.localeCompare(b.created_at));
  const done = visible.filter(task => task.is_done && !quickHolds.has(task.id));
  const completedExpanded = showCompleted || filter === "done";
  const nextMilestone = rewards.filter(reward => reward.streak_target !== null && reward.streak_target > stats.streak).sort((a, b) => a.streak_target! - b.streak_target!)[0];
  const course = tasks.find(task => task.id === courseId && task.course_items !== null);
  const newTask = (kind: TaskKind = "normal") => { setEditing(null); setInitialKind(kind); setFilter("all"); setQuery(""); setFormOpen(true); };
  const editTask = (task: Task) => { setEditing(task); setFormOpen(true); };
  const openCourse = (id: string) => {
    courseOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openedCourseId.current = id;
    setCourseId(id);
  };

  useEffect(() => {
    const released = [...previousQuickHolds.current].filter(id => !quickHolds.has(id) && tasks.some(task => task.id === id && task.is_done));
    previousQuickHolds.current = quickHolds;
    if (released.length && !recordTaskId && !courseId && !unlocked) {
      const focused = document.activeElement as HTMLElement | null;
      const focusedTask = focused?.closest<HTMLElement>('[data-quick-task]')?.dataset.quickTask;
      if (focused === document.body || (focusedTask && released.includes(focusedTask))) {
        requestAnimationFrame(() => completedToggle.current?.focus({ preventScroll: true }));
      }
    }
  }, [quickFeedback, tasks, filter, recordTaskId, courseId, unlocked]);

  useEffect(() => {
    if (courseId && !course) setCourseId(null);
  }, [courseId, course]);

  async function reorder(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id || busy || pendingOrderRef.current) return;
    const ids = tasks.filter(task => !task.is_done).map(task => task.id);
    const from = ids.indexOf(String(event.active.id)), to = ids.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    const nextOrder = arrayMove(ids, from, to);
    const keyboardHandle = event.activatorEvent.type === 'keydown' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pendingOrderRef.current = nextOrder;
    setPendingOrder(nextOrder);
    try {
      await mutate("/tasks/reorder", { ids: nextOrder });
    } catch {
      // The canonical server order remains available for a failed save.
    } finally {
      if (pendingOrderRef.current === nextOrder) {
        pendingOrderRef.current = null;
        setPendingOrder(null);
        if (keyboardHandle?.isConnected) requestAnimationFrame(() => keyboardHandle.focus({ preventScroll: true }));
      }
    }
  }

  function changeView(next: View) {
    setView(next);
    history.replaceState(null, "", `#${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function startFocus(taskId: string) {
    changeView("focus");
    void useFocusStore.getState().start(taskId).catch(() => undefined);
  }

  return <MotionConfig reducedMotion="user"><div className="app-shell"><FocusProvider />
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <aside className="sidebar">
      <a href="/" className="brand" aria-label="PawnSteps 首页"><span className="brand-symbol"><Footprints size={23} strokeWidth={2.2} /></span><span>PawnSteps<small>日拱一卒</small></span></a>
      <div className="sidebar-label">日拱一卒，功不唐捐</div>
      <nav aria-label="主导航">{navigation.map(item => <button key={item.id} onClick={() => changeView(item.id)} className={`nav-item ${view === item.id ? "active" : ""}`} aria-current={view === item.id ? "page" : undefined}><item.icon size={20} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-bottom">
        <div className="utility-row">
          <button className="icon-button" onClick={toggleTheme} aria-label={dark ? "切换浅色模式" : "切换暗色模式"}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
          <button className="icon-button" onClick={toggleMuted} aria-label={muted ? "开启音效" : "静音"} aria-pressed={muted}>{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
          <button className="icon-button" onClick={() => setHelp(true)} aria-label="使用说明"><CircleHelp size={19} /></button>
        </div>
        <button className="sidebar-account" onClick={() => changeView("account")}><span className="avatar">{user?.avatar_url ? <img src={user.avatar_url} alt="我的头像" /> : <UserRound size={21} />}</span><span><strong>{user?.username || "此刻的你"}</strong><small>{user ? "每一天都有新可能" : "游客 · 登录保存"}</small></span></button>
      </div>
    </aside>

    <div className="workspace">
      <header className="workspace-header">
        <div className="topbar">
          <div className="workspace-title"><Footprints size={20} className="mobile-brand" /><h1>{navigation.find(item => item.id === view)?.title}</h1><span className="date-label">{dateLabel}</span></div>
          <div className="topbar-actions">
            {view !== "focus" && <FocusMini onClick={() => changeView("focus")} />}
            {view === "tasks" && hasTasks && <div className="search-field desktop-search"><Search size={17} /><Input aria-label="搜索任务" placeholder="搜索任务" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="清除搜索" onClick={() => setQuery("")}><X size={15} /></button>}</div>}
            {view === "tasks" && hasTasks && <button className="icon-button mobile-tool" aria-label="搜索任务" aria-expanded={searchOpen} onClick={() => setSearchOpen(value => !value)}><Search size={18} /></button>}
            <button className="icon-button mobile-tool" onClick={toggleTheme} aria-label="切换主题">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="icon-button mobile-tool" onClick={toggleMuted} aria-label={muted ? "开启音效" : "静音"} aria-pressed={muted}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
            <button className="icon-button refresh-control" onClick={() => void refresh()} aria-label="刷新进度" disabled={busy || loading}><RefreshCw size={17} /></button>
            {view === "tasks" && <Button ref={addButton} className="add-task-button" onClick={() => newTask()} aria-label="添加任务"><Plus size={18} /><span>添加任务</span></Button>}
          </div>
        </div>
        <section className="stats-row" role="region" aria-label="任务统计">
          {[{ label: "全部目标", value: stats.total }, { label: "已完成", value: stats.completed }, { label: "进行中", value: stats.in_progress }, { label: "成长经验", value: stats.xp }].map(item => <div className="stat" key={item.label}><span>{item.label}</span><strong>{item.value.toLocaleString()}{item.label === "成长经验" && <small>XP</small>}</strong></div>)}
        </section>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {view === "tasks" && hasTasks && searchOpen && <div className="mobile-search-row"><Search size={18} /><Input ref={searchInput} aria-label="搜索任务" placeholder="输入任务名称" value={query} onChange={event => setQuery(event.target.value)} /><button className="icon-button" aria-label="关闭搜索" onClick={() => { setQuery(""); setSearchOpen(false); }}><X size={17} /></button></div>}
        {error && <div className="error-banner" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => changeView("account")}>检查账户</Button><Button variant="ghost" size="sm" onClick={() => void refresh()}>重试</Button></div>}
        {loading ? <div className="loading-state" role="status"><div className="skeleton" /><div className="skeleton" /><p>正在整理你的成长记录</p></div> : <>
          {view === "tasks" && !hasTasks && !error && <section className="onboarding" aria-labelledby="onboarding-title">
            <div className="onboarding-intro"><h2 id="onboarding-title">从一件想做的小事开始</h2><p>选择适合你的方式，把想做的事变成今天的一步。</p></div>
            <div className="onboarding-options" aria-label="选择任务类型">
              {[
                { kind: "normal" as const, title: "目标任务", description: "拆成几个小步骤，一步步完成。", action: "创建目标任务", icon: Flag },
                { kind: "daily" as const, title: "每日打卡", description: "设定每日最低量，把习惯慢慢养成。", action: "创建每日打卡", icon: Sun },
                { kind: "plan" as const, title: "天数计划", description: "安排每天的节奏，也给休息留一点时间。", action: "创建天数计划", icon: CalendarDays },
                { kind: "course" as const, title: "课程学习", description: "导入大纲或文件夹，记录每一节的进度。", action: "导入课程", icon: BookOpen },
              ].map(item => <button key={item.kind} className="onboarding-option" aria-label={item.action} onClick={() => newTask(item.kind)}><item.icon size={21} strokeWidth={1.6} /><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowRight size={18} /></button>)}
            </div>
          </section>}
          {view === "tasks" && hasTasks && <div className="task-workspace">
            <section className="focus-summary" aria-label="今日概览">
              <button onClick={() => setFilter("daily")} aria-label="查看每日打卡"><Sun size={17} /><span>今日达标<strong>{stats.today_completed}<small> / {stats.today_total}</small></strong></span></button>
              <button onClick={() => changeView("calendar")} aria-label="查看连续打卡记录"><TrendingUp size={17} /><span>连续打卡<strong>{stats.streak}<small> 天</small></strong></span></button>
              <button onClick={() => changeView("rewards")} aria-label="查看下个里程碑"><Gift size={17} /><span>{nextMilestone ? "下个里程碑" : "我的奖励"}<strong>{nextMilestone ? `${nextMilestone.streak_target} 天` : "查看成就"}{nextMilestone && <small className="milestone-distance">还差 {nextMilestone.streak_target! - stats.streak} 天</small>}</strong></span><ArrowRight size={15} className="summary-arrow" /></button>
            </section>
            <section className="task-section" aria-label="任务列表">
              <div className="task-toolbar"><div className="filter-tabs" role="group" aria-label="筛选任务">{[["all", "全部"], ["daily", "每日打卡"], ["course", "课程学习"], ["done", "已完成"]].map(([id, title]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)} className={filter === id ? "selected" : ""}>{title}</button>)}</div><span className="task-list-count">{visible.length} 项任务</span></div>
              {!visible.length && <div className="empty-state"><span className="empty-symbol"><Search size={25} /></span><h2>这里暂时没有匹配的任务</h2><p>换个关键词，或者看看其他分类。</p><Button variant="secondary" onClick={() => { setQuery(""); setFilter("all"); }}>查看全部任务<ArrowRight size={16} /></Button></div>}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
                <SortableContext items={active.map(task => task.id)} strategy={verticalListSortingStrategy}>
                  <div className="task-list"><AnimatePresence initial={false}>{active.map(task => <motion.div key={task.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><TaskCard task={task} onEdit={editTask} onOpenCourse={openCourse} onOpenRecords={setRecordTaskId} onStartFocus={startFocus} /></motion.div>)}</AnimatePresence></div>
                </SortableContext>
                {resting.length > 0 && <section className="completed-section">
                  <button className="completed-toggle" aria-label="今日休息的任务" aria-expanded={restExpanded} aria-controls="resting-task-list" onClick={() => setShowRest(value => !value)}><ChevronDown size={17} className={restExpanded ? '' : 'collapsed'} /><Moon size={16} /><span>今日休息</span><span className="completed-count">{resting.length}</span><span className="completed-hint">{restExpanded ? '收起' : '展开查看'}</span></button>
                  {restExpanded && <SortableContext items={resting.map(task => task.id)} strategy={verticalListSortingStrategy}><div id="resting-task-list" role="region" aria-label="今日休息任务列表" className="task-list">{resting.map(task => <TaskCard key={task.id} task={task} onEdit={editTask} onOpenCourse={openCourse} onOpenRecords={setRecordTaskId} onStartFocus={startFocus} />)}</div></SortableContext>}
                </section>}
                {done.length > 0 && <section className="completed-section">
                  <button ref={completedToggle} className="completed-toggle" aria-label="已完成任务" aria-expanded={completedExpanded} aria-controls="completed-task-list" onClick={() => { if (filter === "done") { setFilter("all"); setShowCompleted(false); } else setShowCompleted(value => !value); }}><ChevronDown size={17} className={completedExpanded ? "" : "collapsed"} /><Check size={16} /><span>已完成任务</span><span className="completed-count" aria-hidden="true">{done.length}</span><span className="completed-hint" aria-hidden="true">{completedExpanded ? "收起" : "展开查看"}</span></button>
                  {completedExpanded && <div id="completed-task-list" role="region" aria-label="已完成任务列表" className="task-list">{done.map(task => <TaskCard key={task.id} task={task} onEdit={editTask} onOpenCourse={openCourse} onOpenRecords={setRecordTaskId} onStartFocus={startFocus} />)}</div>}
                </section>}
              </DndContext>
            </section>
          </div>}
          {view === "focus" && <FocusPanel />}
          {view === "calendar" && <CalendarPanel onReview={() => changeView("review")} />}
          {view === "review" && <ReviewPanel onCalendar={() => changeView("calendar")} onTask={id => { const task = tasks.find(item => item.id === id); if (task?.course_items) openCourse(id); else setRecordTaskId(id); }} />}
          {view === "rewards" && <RewardsPanel />}
          {view === "account" && <AccountPanel />}
        </>}
      </main>
      <footer className="page-footer"><span>PawnSteps · 每一步，都算数</span><Link href="/admin">管理入口</Link></footer>
    </div>

    <nav className="mobile-nav" aria-label="移动导航">{navigation.filter(item => item.id !== "review").map(item => <button key={item.id} aria-label={item.label} className={view === item.id || view === "review" && item.id === "calendar" ? "active" : ""} onClick={() => changeView(item.id)} aria-current={view === item.id || view === "review" && item.id === "calendar" ? "page" : undefined}><item.icon size={21} />{item.id === "focus" ? <FocusNavLabel /> : <span>{item.label}</span>}</button>)}</nav>
    <TaskForm open={formOpen} onOpenChange={setFormOpen} task={editing} initialKind={initialKind} />
    <ProgressRecords taskId={recordTaskId} onClose={() => setRecordTaskId(null)} returnFocus={view === "review" ? () => document.getElementById("main-content") : undefined} />
    <Dialog open={Boolean(course)} onOpenChange={open => { if (!open) setCourseId(null); }}>
      <DialogContent className="course-drawer" onCloseAutoFocus={event => {
        event.preventDefault();
        const finished = useAppStore.getState().tasks.find(task => task.id === openedCourseId.current)?.is_done;
        const target = (finished && !completedExpanded ? completedToggle.current : courseOpener.current?.isConnected ? courseOpener.current : completedToggle.current || addButton.current) || document.getElementById("main-content");
        target?.focus({ preventScroll: true });
      }}>
        {course && <>
          <div className="course-drawer-header"><span className="course-drawer-eyebrow"><BookOpen size={16} />课程学习{(course.daily_goal || course.daily_minimum) > 0 && <span className={`course-daily-summary ${course.daily_done ? 'is-met' : ''}`} title={`每天最少 ${course.daily_minimum} 节，目标 ${course.daily_goal ?? course.daily_minimum} 节`}>今日 {course.today_amount} / {course.daily_goal ?? course.daily_minimum} 节{course.daily_done ? ' · 已达标' : ''}</span>}</span><DialogTitle>{course.name}</DialogTitle><DialogDescription className={course.description ? undefined : "sr-only"}>{course.description || "逐项勾选课程，记录学习进度。"}</DialogDescription><div className="course-drawer-progress"><span>{course.is_done ? "课程已完成" : "学习进度"}</span><strong>{course.progress} / {course.target} 节</strong></div><div className="course-progress-track"><span style={{ width: `${course.target ? course.progress / course.target * 100 : 0}%` }} /></div></div>
          <div className="course-drawer-body"><CourseItems key={course.id} task={course} /></div>
          <div className="course-drawer-footer"><span>{course.is_done ? "这一程，已经走完。" : "每完成一节，都在向前。"}</span><Button variant="secondary" onClick={() => setCourseId(null)}>{view === "review" ? "返回每周回顾" : "返回任务列表"}</Button></div>
        </>}
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(unlocked) && !recordTaskId && !courseId && !formOpen && !quickFeedbackVisible && (!completionUndo || completionUndo.rewardId === unlocked?.id)} onOpenChange={open => { if (!open) dismissUnlock(); }}><DialogContent className="unlock-dialog"><motion.div className="unlock-icon" initial={{ scale: .6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", damping: 14 }}><Gift size={52} strokeWidth={1.3} /></motion.div><p className="eyebrow">努力，值得被好好奖励</p><DialogTitle>一个心愿，解锁了。</DialogTitle><DialogDescription>你为「{unlocked?.name}」走过的每一步，都有意义。</DialogDescription>{unlocked?.image_url && <img className="unlock-image" src={unlocked.image_url} alt={unlocked.name} />}<Button onClick={() => { dismissUnlock(); changeView("rewards"); }}>收下这份奖励<Check size={16} /></Button>{completionUndo?.rewardId === unlocked?.id && completionUndo && <Button variant="ghost" disabled={completionUndo.pending || busy} onClick={() => void undoCompletion()}>撤销</Button>}</DialogContent></Dialog>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent><DialogTitle>一步一步，用好 PawnSteps</DialogTitle><DialogDescription>让任务跟着你的节奏走。</DialogDescription><div className="help-content"><p><strong>普通任务：</strong>点击 +1、+5 记录进度，点错用 −1 修正；全部完成时可通过提示撤回最后一笔，其他数量和备注可从记录入口操作。</p><p><strong>每日打卡：</strong>一天可以记录多次，达到每日最低量才计为达标；超额完成不重复累计天数。</p><p><strong>计划任务：</strong>按当天配额记录，0 和 -1 是休息日；到期标记结束，进度保留实际完成量。</p><p><strong>课程学习：</strong>点击“继续学习”打开课程清单；鼠标可从条目或空白处框选。已完成项再框选可取消，Shift + 框选强制取消；完成的条目和章节会变绿。</p><p><strong>打卡日历：</strong>有进度就显示圆点，低于最低量、达标和超额分别展示；未做的日期没有圆点。</p><p><strong>已完成任务：</strong>收在列表底部，展开后可以查看和调整。</p><p className="muted">打卡时区：{timezone}。游客可创建 10 个任务，其中每日或计划任务最多 3 个。</p></div><Button variant="secondary" onClick={toggleMuted}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}{muted ? "开启音效" : "静音"}</Button></DialogContent></Dialog>
    <Toaster theme={dark ? "dark" : "light"} position="bottom-right" richColors closeButton />
  </div></MotionConfig>;
}
