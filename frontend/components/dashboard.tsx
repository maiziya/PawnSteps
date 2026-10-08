"use client";
import { useEffect, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { ArrowRight, CalendarDays, Check, CheckCheck, ChevronRight, CircleHelp, Footprints, Gift, LayoutDashboard, Moon, Plus, RefreshCw, Search, Shield, Sparkles, Sprout, Sun, Target, TrendingUp, UserRound, Volume2, VolumeX } from "lucide-react";
import { Toaster } from "sonner";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import { primeAudio } from "@/lib/audio";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TaskCard } from "@/components/task-card";
import { TaskForm } from "@/components/task-form";
import { AccountPanel } from "@/components/account-panel";
import { RewardsPanel } from "@/components/rewards-panel";
import { CalendarPanel } from "@/components/calendar-panel";

const navigation = [
  { id: "tasks", label: "我的步履", icon: LayoutDashboard },
  { id: "calendar", label: "打卡日历", icon: CalendarDays },
  { id: "rewards", label: "心愿奖励", icon: Gift },
  { id: "account", label: "个人中心", icon: UserRound },
] as const;
type View = typeof navigation[number]["id"];

export function Dashboard() {
  const { tasks, rewards, stats, user, timezone, loading, busy, error, dark, muted, unlocked, initialize, refresh, mutate, toggleTheme, toggleMuted, dismissUnlock } = useAppStore();
  const [view, setView] = useState<View>("tasks");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [help, setHelp] = useState(false);
  const [dateLabel, setDateLabel] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    void initialize();
    if (location.hash === "#account") setView("account");
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    document.addEventListener("pointerdown", primeAudio);
    document.addEventListener("keydown", primeAudio);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); document.removeEventListener("pointerdown", primeAudio); document.removeEventListener("keydown", primeAudio); };
  }, [initialize, refresh]);

  useEffect(() => {
    setDateLabel(new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "long", day: "numeric", weekday: "long" }).format(new Date()));
  }, [timezone, stats]);

  const visible = tasks.filter(task => task.name.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || (filter === "daily" && (task.daily_quota > 0 || task.daily_plan !== null)) || (filter === "course" && task.course_items !== null) || (filter === "done" && task.is_done)));
  const active = visible.filter(task => !task.is_done);
  const done = visible.filter(task => task.is_done);
  const nextMilestone = rewards.filter(r => r.streak_target !== null && r.streak_target > stats.streak).sort((a, b) => a.streak_target! - b.streak_target!)[0];
  const ratio = stats.today_total ? stats.today_completed / stats.today_total : 0;
  const newTask = () => { setEditing(null); setFormOpen(true); };
  const editTask = (task: Task) => { setEditing(task); setFormOpen(true); };
  async function reorder(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id || busy) return;
    const ids = tasks.filter(task => !task.is_done).map(task => task.id);
    const from = ids.indexOf(String(event.active.id)), to = ids.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    await mutate("/tasks/reorder", { ids: arrayMove(ids, from, to) }).catch(() => undefined);
  }

  return <MotionConfig reducedMotion="user"><div className="app-shell">
    <aside className="sidebar">
      <a href="/" className="brand" aria-label="PawnSteps 首页"><span className="brand-symbol"><Footprints size={23} strokeWidth={2.2} /></span><span>PawnSteps<small>日拱一卒</small></span></a>
      <div className="sidebar-label">留一点时间，给自己</div>
      <nav aria-label="主导航">{navigation.map(item => <button key={item.id} onClick={() => setView(item.id)} className={`nav-item ${view === item.id ? "active" : ""}`} aria-current={view === item.id ? "page" : undefined}><item.icon size={20} /><span>{item.label}</span>{item.id === "tasks" && stats.in_progress > 0 && <span className="nav-count">{stats.in_progress}</span>}</button>)}</nav>
      <div className="sidebar-note"><Sprout size={26} /><p>日拱一卒，<br />功不唐捐。</p><span>每一步，都算数。</span></div>
      <div className="sidebar-bottom"><div className="utility-row"><button className="icon-button" onClick={toggleTheme} aria-label={dark ? "切换浅色模式" : "切换暗色模式"}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><button className="icon-button" onClick={toggleMuted} aria-label={muted ? "开启音效" : "静音"} aria-pressed={muted}>{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button><button className="icon-button" onClick={() => setHelp(true)} aria-label="使用说明"><CircleHelp size={19} /></button></div><button className="sidebar-account" onClick={() => setView("account")}><span className="avatar">{user?.avatar_url ? <img src={user.avatar_url} alt="我的头像" /> : <UserRound size={21} />}</span><span><strong>{user?.username || "此刻的你"}</strong><small>{user ? "每一天都有新可能" : "游客体验 · 登录保存成长"}</small></span><ChevronRight size={16} /></button></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><Footprints size={18} className="mobile-brand" /><span>你的成长空间</span><ChevronRight size={14} /><strong>{navigation.find(item => item.id === view)?.label}</strong></div><div className="topbar-actions"><span className="date-label">{dateLabel}</span><button className="icon-button mobile-tool" onClick={toggleTheme} aria-label="切换主题">{dark ? <Sun size={18} /> : <Moon size={18} />}</button><button className="icon-button mobile-tool" onClick={toggleMuted} aria-label={muted ? "开启音效" : "静音"} aria-pressed={muted}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><button className="icon-button" onClick={() => void refresh()} aria-label="刷新进度" disabled={busy || loading}><RefreshCw size={17} /></button></div></header>
      <main id="main-content" className="main-content">
        <div className="page-heading"><div><p className="eyebrow">{view === "tasks" ? "一点一滴，积累成你想要的样子" : "给认真生活的自己，留下一点记录"}</p><h1>{view === "tasks" ? "今天，也向前一步。" : navigation.find(item => item.id === view)?.label}</h1></div>{view === "tasks" && <Button onClick={newTask}><Plus size={18} />添加任务</Button>}</div>
        <section className="stats-row" aria-label="成长统计">{[{ label: "全部目标", value: stats.total, icon: Target }, { label: "已完成", value: stats.completed, icon: CheckCheck }, { label: "进行中", value: stats.in_progress, icon: TrendingUp }, { label: "成长经验", value: stats.xp, icon: Sparkles }].map(item => <div className="stat" key={item.label}><div><span>{item.label}</span><strong>{item.value.toLocaleString()}<small>{item.label === "成长经验" ? "XP" : "项"}</small></strong></div><item.icon size={21} strokeWidth={1.5} /></div>)}</section>
        {error && <div className="error-banner" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => { setView("account"); }}>检查账户</Button><Button variant="ghost" size="sm" onClick={() => void refresh()}>重试</Button></div>}
        {loading ? <div className="loading-state" role="status"><div className="skeleton" /><div className="skeleton" /><p>正在整理你的成长记录</p></div> : <>
          {view === "tasks" && <div className="dashboard-columns"><div className="task-workspace">
            <section className="daily-intro"><div><span className="intro-label"><Sprout size={15} />小步前行，自有回响</span><h2>{stats.today_total > 0 ? `今天的 ${stats.today_total} 个约定，慢慢完成。` : "从一个小小的约定开始。"}</h2><p>{stats.today_total > 0 ? `已经兑现 ${stats.today_completed} 个。把注意力留给眼前这一小步。` : "读几页书、动一动身体，或者学一点新东西。"}</p><button onClick={newTask} className="text-action">{stats.total ? "为自己定个新目标" : "写下你的第一个目标"}<ArrowRight size={16} /></button></div><div className="intro-art" aria-hidden="true"><div className="plant-disc"><Sprout size={72} strokeWidth={1.15} /></div><span className="plant-ground" /></div></section>
            <section className="task-section" aria-label="任务列表"><div className="section-heading"><h2>我的任务 <span>{tasks.length}</span></h2><div className="search-field"><Search size={16} /><Input aria-label="搜索任务" placeholder="搜索任务" value={query} onChange={event => setQuery(event.target.value)} /></div></div><div className="filter-tabs" role="group" aria-label="筛选任务">{[["all", "全部"], ["daily", "每日打卡"], ["course", "课程学习"], ["done", "已完成"]].map(([id, title]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)} className={filter === id ? "selected" : ""}>{title}</button>)}</div>
              {!visible.length && <div className="empty-state panel"><span className="empty-symbol"><Footprints size={30} /></span><h3>{tasks.length ? "这里暂时没有匹配的任务" : "每段旅程，都始于一小步"}</h3><p>{tasks.length ? "换个关键词，或者看看其他分类。" : "把想做的事写下来，再把它变成今天做得到的一步。"}</p><Button variant="secondary" onClick={tasks.length ? () => { setQuery(""); setFilter("all"); } : newTask}>{tasks.length ? "查看全部任务" : "创建第一个任务"}<ArrowRight size={16} /></Button></div>}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}><SortableContext items={active.map(task => task.id)} strategy={verticalListSortingStrategy}><div className="task-list"><AnimatePresence initial={false}>{active.map(task => <motion.div key={task.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><TaskCard task={task} onEdit={editTask} /></motion.div>)}</AnimatePresence></div></SortableContext>{done.length > 0 && <div className="completed-section"><h3><Check size={15} />已经抵达 <span>{done.length}</span></h3><div className="task-list">{done.map(task => <TaskCard key={task.id} task={task} onEdit={editTask} />)}</div></div>}</DndContext>
            </section>
          </div><aside className="insight-column"><section className="panel today-panel"><div className="section-heading"><h2>今日节奏</h2><Sun size={20} /></div><div className="progress-ring"><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="64" className="ring-track" /><circle cx="80" cy="80" r="64" className="ring-progress" strokeDasharray={`${ratio * 402.124} 402.124`} /></svg><div><strong>{stats.today_completed}<small>/{stats.today_total}</small></strong><span>今日已达标</span></div></div><p>{stats.today_total && stats.today_completed === stats.today_total ? "今天的约定全部兑现了，好好奖励自己。" : "不求一步到位，只求每天靠近。"}</p><div className="streak-line"><span><TrendingUp size={17} />连续打卡</span><strong>{stats.streak}<small>天</small></strong></div></section>
            <section className="panel milestone-preview"><div className="section-heading"><h2>下一个里程碑</h2><Gift size={18} /></div><div className="milestone-mark"><Sprout size={34} strokeWidth={1.4} /></div><h3>{nextMilestone ? `${nextMilestone.streak_target} 天的坚持` : "每一次坚持，都是新起点"}</h3><p>{nextMilestone ? `再走 ${nextMilestone.streak_target! - stats.streak} 天，收下这份成长纪念。` : "继续保持自己的节奏。"}</p><div className="milestone-progress"><span style={{ width: `${nextMilestone ? Math.min(100, stats.streak / nextMilestone.streak_target! * 100) : 100}%` }} /></div><button className="text-action" onClick={() => setView("rewards")}>看看我的奖励<ArrowRight size={15} /></button></section>
            {!user && <button className="guest-note" onClick={() => setView("account")}><Shield size={19} /><span><strong>让成长记录有个家</strong><small>注册后，游客数据会一同保留。</small></span><ChevronRight size={16} /></button>}
          </aside></div>}
          {view === "calendar" && <CalendarPanel />}{view === "rewards" && <RewardsPanel />}{view === "account" && <AccountPanel />}
        </>}
        <footer className="page-footer"><span>PawnSteps · 不疾而速，每步有数</span><Link href="/admin">管理入口</Link></footer>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="移动导航">{navigation.map(item => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)} aria-current={view === item.id ? "page" : undefined}><item.icon size={21} /><span>{item.label}</span></button>)}</nav>
    <TaskForm open={formOpen} onOpenChange={setFormOpen} task={editing} />
    <Dialog open={Boolean(unlocked)} onOpenChange={open => { if (!open) dismissUnlock(); }}><DialogContent className="unlock-dialog"><motion.div className="unlock-icon" initial={{ scale: .6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", damping: 14 }}><Gift size={52} strokeWidth={1.3} /></motion.div><p className="eyebrow">努力，值得被好好奖励</p><DialogTitle>一个心愿，解锁了。</DialogTitle><DialogDescription>你为「{unlocked?.name}」走过的每一步，都有意义。</DialogDescription>{unlocked?.image_url && <img className="unlock-image" src={unlocked.image_url} alt={unlocked.name} />}<Button onClick={() => { dismissUnlock(); setView("rewards"); }}>收下这份奖励<Check size={16} /></Button></DialogContent></Dialog>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent><DialogTitle>一步一步，用好 PawnSteps</DialogTitle><DialogDescription>让任务跟着你的节奏走。</DialogDescription><div className="help-content"><p><strong>普通任务：</strong>用加减按钮或拖动进度条记录每一步。</p><p><strong>每日打卡：</strong>完成今天的配额，累计一个达标日；当天可以撤销。</p><p><strong>计划任务：</strong>按预设配额前进，0 和 -1 都是休息日。</p><p><strong>课程学习：</strong>导入 Markdown 大纲或文件夹，逐项勾选；鼠标可框选批量操作。</p><p><strong>日历与奖励：</strong>查看成长记录，为完成目标设置一份期待。</p><p className="muted">打卡时区：{timezone}。游客可创建 10 个任务，其中每日或计划任务最多 3 个。注册时可迁移游客记录。</p></div><Button variant="secondary" onClick={() => { toggleMuted(); }}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}{muted ? "开启音效" : "静音"}</Button></DialogContent></Dialog>
    <Toaster theme={dark ? "dark" : "light"} position="bottom-right" richColors closeButton />
  </div></MotionConfig>;
}
