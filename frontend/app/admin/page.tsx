"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Download, KeyRound, LogOut, Search, ShieldCheck, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HistoryEntry, MutationResponse, User } from "@/lib/types";

type AdminUser = User & { is_admin: boolean };
type UserPage = { users: AdminUser[]; total: number; offset: number; limit: number };
type UserData = MutationResponse & { user: User; daily_history: HistoryEntry[]; exported_at: string };
const TOKEN_KEY = "pawnsteps-admin-token";

async function adminApi<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin${path}`, { ...options, cache: "no-store", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && token) { sessionStorage.removeItem(TOKEN_KEY); window.dispatchEvent(new Event("pawnsteps-admin-expired")); }
    throw new Error(typeof data.detail === "string" ? data.detail : "请求未完成，请稍后重试");
  }
  return response.json() as Promise<T>;
}

function AdminLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await adminApi<MutationResponse>("/login", "", { method: "POST", body: JSON.stringify({ identifier, password, migrate_guest: false }) });
      if (!data.access_token) throw new Error("未收到有效的管理员凭证");
      sessionStorage.setItem(TOKEN_KEY, data.access_token); onLogin(data.access_token);
    } catch (value) { setError(value instanceof Error ? value.message : "登录失败"); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-[var(--canvas)] p-6"><section className="panel w-full max-w-md p-7 sm:p-9"><Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-[var(--muted)]"><ArrowLeft size={16} />返回日拱一卒</Link><ShieldCheck size={34} strokeWidth={1.5} className="mb-4 text-[var(--accent)]" /><h1 className="text-2xl font-semibold">管理工作台</h1><p className="mt-2 text-sm text-[var(--muted)]">使用独立的管理员账号登录。</p><form onSubmit={event => void submit(event)} className="mt-7 space-y-5"><label className="block space-y-2 text-sm font-medium">管理员账号<Input value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" required /></label><label className="block space-y-2 text-sm font-medium">密码<Input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p role="alert" className="text-sm text-[var(--accent)]">{error}</p>}<Button type="submit" disabled={busy} className="w-full"><KeyRound size={17} />{busy ? "正在验证…" : "登录管理后台"}</Button></form></section></main>;
}

function UserDetail({ data, onClose }: { data: UserData; onClose: () => void }) {
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `pawnsteps-user-${data.user.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel overflow-hidden"><div className="flex items-start justify-between gap-4 border-b border-[var(--line)] p-6"><div><h2 className="text-xl font-semibold">{data.user.username || "未命名用户"}</h2><p className="mt-1 break-all text-sm text-[var(--muted)]">{data.user.email || data.user.id}</p></div><Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭用户详情"><X size={19} /></Button></div><div className="space-y-7 p-6"><dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">{[["总任务", data.stats.total], ["已完成", data.stats.completed], ["经验", data.stats.xp], ["连续打卡", data.stats.streak]].map(([label, value]) => <div key={label}><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>)}</dl><div><h3 className="mb-3 font-semibold">任务 · {data.tasks.length}</h3>{data.tasks.length ? <ul className="divide-y divide-[var(--line)]">{data.tasks.map(task => <li key={task.id} className="py-3"><div className="flex justify-between gap-4"><span className="font-medium">{task.name}</span><span className="shrink-0 text-sm tabular-nums text-[var(--muted)]">{task.progress} / {task.target}{task.is_done ? " · 完成" : ""}</span></div><p className="mt-1 text-xs text-[var(--muted)]">{task.course_items ? "课程" : task.daily_plan ? "计划" : task.daily_quota ? "每日打卡" : "普通任务"} · {task.priority === "high" ? "高优先级" : task.priority === "medium" ? "中优先级" : "低优先级"}</p>{task.description && <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{task.description}</p>}{task.course_items && <details className="mt-2 text-sm"><summary className="cursor-pointer text-[var(--muted)]">查看课程条目</summary><ul className="mt-2 space-y-1 border-l border-[var(--line)] pl-4">{task.course_items.map((item, index) => <li key={index} className={item.done ? "text-[var(--success)]" : "text-[var(--muted)]"}>{item.name}{item.done ? " · 已完成" : ""}</li>)}</ul></details>}</li>)}</ul> : <p className="text-sm text-[var(--muted)]">暂无任务</p>}</div><div><h3 className="mb-3 font-semibold">奖励 · {data.rewards.length}</h3><ul className="divide-y divide-[var(--line)]">{data.rewards.map(reward => <li key={reward.id} className="flex items-center justify-between gap-4 py-3 text-sm"><span>{reward.name}{reward.streak_target ? ` · 连续 ${reward.streak_target} 天` : ""}</span><span className={reward.is_unlocked ? "text-[var(--success)]" : "text-[var(--muted)]"}>{reward.is_unlocked ? "已解锁" : "待解锁"}</span></li>)}</ul></div><p className="text-sm text-[var(--muted)]">共 {data.daily_history.length} 条每日记录。完整任务字段及历史可通过数据导出查看。</p><Button variant="outline" onClick={download}><Download size={16} />导出用户数据</Button></div></section>;
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<UserPage>({ users: [], total: 0, offset: 0, limit: 20 });
  const [selected, setSelected] = useState<UserData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setToken(sessionStorage.getItem(TOKEN_KEY)); setReady(true); const expire = () => { setToken(null); setSelected(null); }; window.addEventListener("pawnsteps-admin-expired", expire); return () => window.removeEventListener("pawnsteps-admin-expired", expire); }, []);
  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true); setError("");
    try { setPage(await adminApi<UserPage>(`/users?limit=20&offset=${offset}&q=${encodeURIComponent(filter)}`, token)); }
    catch (value) { setError(value instanceof Error ? value.message : "加载用户失败"); }
    finally { setBusy(false); }
  }, [token, offset, filter]);
  useEffect(() => { void load(); }, [load]);
  if (!ready) return <main className="flex min-h-screen items-center justify-center bg-[var(--canvas)] text-[var(--muted)]">正在打开工作台…</main>;
  if (!token) return <AdminLogin onLogin={setToken} />;
  return <main className="min-h-screen bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-8"><div className="mx-auto max-w-7xl"><header className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--muted)]"><ArrowLeft size={16} />返回日拱一卒</Link><h1 className="flex items-center gap-3 text-2xl font-semibold"><ShieldCheck className="text-[var(--accent)]" />管理工作台</h1></div><Button variant="outline" onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(null); setSelected(null); }}><LogOut size={16} />退出管理员</Button></header><div className={`grid items-start gap-6 ${selected ? "xl:grid-cols-[1fr_1fr]" : ""}`}><section className="panel overflow-hidden"><div className="border-b border-[var(--line)] p-5 sm:p-6"><h2 className="flex items-center gap-2 text-lg font-semibold"><Users size={20} />所有用户 <span className="ml-auto text-sm font-normal text-[var(--muted)]">共 {page.total} 位</span></h2><form className="mt-5 flex gap-2" onSubmit={event => { event.preventDefault(); setOffset(0); setFilter(query); }}><Input aria-label="搜索用户名或邮箱" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索用户名或邮箱" /><Button type="submit" variant="outline" disabled={busy}><Search size={17} /><span className="sr-only sm:not-sr-only">搜索</span></Button></form></div>{error && <p role="alert" className="p-6 text-sm text-[var(--accent)]">{error}<button type="button" className="ml-3 cursor-pointer underline" onClick={() => void load()}>重试</button></p>}<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]"><th className="p-4 font-medium sm:pl-6">用户</th><th className="p-4 font-medium">注册日期</th><th className="p-4 font-medium">详情</th></tr></thead><tbody>{page.users.map(user => <tr key={user.id} className="border-b border-[var(--line)] last:border-0"><td className="p-4 sm:pl-6"><div className="font-medium">{user.username || "未命名用户"}{user.is_admin && <span className="ml-2 text-xs font-normal text-[var(--accent)]">管理员</span>}</div><div className="mt-1 max-w-56 truncate text-xs text-[var(--muted)]" title={user.email || user.id}>{user.email || user.id}</div></td><td className="whitespace-nowrap p-4 text-[var(--muted)]">{new Date(user.created_at).toLocaleDateString("zh-CN")}</td><td className="p-4"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void (async () => { setBusy(true); try { setSelected(await adminApi<UserData>(`/users/${user.id}`, token)); } catch (value) { toast.error(value instanceof Error ? value.message : "无法加载用户详情"); } finally { setBusy(false); } })()}>查看<ArrowRight size={15} /></Button></td></tr>)}</tbody></table>{!page.users.length && <p role="status" className="p-10 text-center text-sm text-[var(--muted)]">{busy ? "正在加载用户…" : "没有匹配的用户"}</p>}</div><div className="flex items-center justify-between gap-3 border-t border-[var(--line)] p-4"><Button variant="ghost" size="sm" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}><ArrowLeft size={15} />上一页</Button><span className="text-xs tabular-nums text-[var(--muted)]">第 {Math.floor(offset / 20) + 1} 页</span><Button variant="ghost" size="sm" disabled={busy || offset + 20 >= page.total} onClick={() => setOffset(offset + 20)}>下一页<ArrowRight size={15} /></Button></div></section>{selected && <UserDetail data={selected} onClose={() => setSelected(null)} />}</div></div></main>;
}
