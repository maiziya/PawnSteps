"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Check, Download, KeyRound, LogOut, Mail, QrCode, ShieldCheck, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";

const password = z.string().min(10, "密码至少需要 10 个字符").refine(value => new TextEncoder().encode(value).length <= 72, "密码不能超过 72 个 UTF-8 字节");
const username = z.string().min(3, "用户名至少需要 3 个字符").max(40, "用户名最多 40 个字符").regex(/^[a-zA-Z0-9_.-]+$/, "请使用字母、数字、点、短横线或下划线");
const credentials = z.object({ identifier: z.string().min(1, "请输入账号或邮箱"), password: z.string().min(1, "请输入密码"), migrate_guest: z.boolean() });
const registration = z.object({ username, password, email: z.union([z.email("请输入有效邮箱"), z.literal("")]), email_code: z.string(), migrate_guest: z.boolean() }).superRefine((value, context) => {
  if (value.email && !/^\d{6}$/.test(value.email_code)) context.addIssue({ code: "custom", path: ["email_code"], message: "请输入邮箱收到的 6 位验证码" });
});
const emailLogin = z.object({ email: z.email("请输入有效邮箱"), code: z.string().regex(/^\d{6}$/, "请输入 6 位验证码"), migrate_guest: z.boolean() });
const passwordChange = z.object({ current_password: z.string(), new_password: password });

type SignInMode = "password" | "register" | "email" | "wechat";

function ErrorText({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-1 text-sm text-[var(--accent)]">{text}</p> : null;
}

function GuestMigration({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-start gap-3 text-sm text-[var(--muted)]"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" /><span>将当前游客任务、奖励和打卡记录合并到此账号</span></label>;
}

function useCodeSender() {
  const mutate = useAppStore(state => state.mutate);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return { remaining, send: async (email: string) => {
    if (!z.email().safeParse(email).success) { toast.error("请先填写有效的邮箱地址"); return; }
    try {
      const response = await mutate("/auth/email-code", { email });
      setRemaining(response.retry_after || 60);
      toast.success("验证码已发送，请查看邮箱");
    } catch { /* The store displays the server error. */ }
  } };
}

function PasswordSignIn() {
  const { mutate, busy } = useAppStore();
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<z.infer<typeof credentials>>({ resolver: zodResolver(credentials), defaultValues: { identifier: "", password: "", migrate_guest: true } });
  return <form className="space-y-5" onSubmit={handleSubmit(async data => { try { await mutate("/auth/login", data); toast.success("欢迎回来"); } catch {} })}>
    <label className="block space-y-2 text-sm font-medium">账号或邮箱<Input autoComplete="username" {...register("identifier")} /><ErrorText text={errors.identifier?.message} /></label>
    <label className="block space-y-2 text-sm font-medium">密码<Input type="password" autoComplete="current-password" {...register("password")} /><ErrorText text={errors.password?.message} /></label>
    <GuestMigration checked={watch("migrate_guest")} onChange={value => setValue("migrate_guest", value)} />
    <Button disabled={busy} className="w-full" type="submit">{busy ? "正在登录…" : "登录"}<ArrowRight size={17} /></Button>
  </form>;
}

function Register() {
  const { mutate, busy } = useAppStore();
  const { remaining, send } = useCodeSender();
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<z.infer<typeof registration>>({ resolver: zodResolver(registration), defaultValues: { username: "", password: "", email: "", email_code: "", migrate_guest: true } });
  const email = watch("email");
  return <form className="space-y-5" onSubmit={handleSubmit(async data => {
    try { await mutate("/auth/register", { ...data, email: data.email || null, email_code: data.email ? data.email_code : null }); toast.success("账号创建成功，你的积累已保存"); } catch {}
  })}>
    <label className="block space-y-2 text-sm font-medium">用户名<Input autoComplete="username" {...register("username")} placeholder="给自己起个名字" /><ErrorText text={errors.username?.message} /></label>
    <label className="block space-y-2 text-sm font-medium">密码<Input type="password" autoComplete="new-password" {...register("password")} placeholder="至少 10 个字符" /><ErrorText text={errors.password?.message} /></label>
    <label className="block space-y-2 text-sm font-medium">邮箱 <span className="font-normal text-[var(--muted)]">选填，验证后可用于登录</span><Input type="email" autoComplete="email" {...register("email")} /><ErrorText text={errors.email?.message} /></label>
    {email && <div><label htmlFor="register-code" className="mb-2 block text-sm font-medium">邮箱验证码</label><div className="flex gap-2"><Input id="register-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...register("email_code")} /><Button type="button" variant="outline" disabled={busy || remaining > 0} onClick={() => void send(email)}>{remaining ? `${remaining} 秒后重发` : "发送验证码"}</Button></div><ErrorText text={errors.email_code?.message} /></div>}
    <GuestMigration checked={watch("migrate_guest")} onChange={value => setValue("migrate_guest", value)} />
    <Button className="w-full" disabled={busy} type="submit">{busy ? "正在创建…" : "创建账号"}<ArrowRight size={17} /></Button>
  </form>;
}

function EmailSignIn() {
  const { mutate, busy } = useAppStore();
  const { remaining, send } = useCodeSender();
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<z.infer<typeof emailLogin>>({ resolver: zodResolver(emailLogin), defaultValues: { email: "", code: "", migrate_guest: true } });
  return <form className="space-y-5" onSubmit={handleSubmit(async data => { try { await mutate("/auth/email-login", data); toast.success("邮箱登录成功"); } catch {} })}>
    <p className="text-sm leading-6 text-[var(--muted)]">无需记住密码。首次使用的邮箱会自动创建账号。</p>
    <label className="block space-y-2 text-sm font-medium">邮箱地址<Input type="email" autoComplete="email" {...register("email")} /><ErrorText text={errors.email?.message} /></label>
    <div><label htmlFor="login-code" className="mb-2 block text-sm font-medium">验证码</label><div className="flex gap-2"><Input id="login-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...register("code")} /><Button type="button" variant="outline" disabled={busy || remaining > 0} onClick={() => void send(watch("email"))}>{remaining ? `${remaining} 秒后重发` : "发送验证码"}</Button></div><ErrorText text={errors.code?.message} /></div>
    <GuestMigration checked={watch("migrate_guest")} onChange={value => setValue("migrate_guest", value)} />
    <Button className="w-full" type="submit" disabled={busy}>{busy ? "正在验证…" : "验证并登录"}<Mail size={17} /></Button>
  </form>;
}

function WechatSignIn() {
  const { mutate, busy } = useAppStore();
  return <div className="space-y-6 py-3 text-center"><div className="mx-auto flex size-24 items-center justify-center rounded-3xl bg-[var(--canvas)] text-[var(--success)]"><QrCode size={48} strokeWidth={1.4} /></div><div><h3 className="font-semibold">用微信继续你的积累</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">前往微信安全登录页，用手机扫描二维码。授权后将返回这里，并合并当前游客数据。</p></div><Button className="w-full" disabled={busy} onClick={() => void (async () => { try { const result = await mutate("/auth/wechat/start", {}); if (result.authorization_url) window.location.assign(result.authorization_url); } catch {} })()}>前往微信扫码<ArrowRight size={17} /></Button></div>;
}

function Profile() {
  const { user, stats, mutate, logout, busy } = useAppStore();
  const [displayName, setDisplayName] = useState(user?.username || "");
  const [downloading, setDownloading] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof passwordChange>>({ resolver: zodResolver(passwordChange), defaultValues: { current_password: "", new_password: "" } });
  if (!user) return null;
  async function downloadData() {
    setDownloading(true);
    try {
      const data = await api<unknown>("/profile/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `pawnsteps-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("数据已导出");
    } catch (error) { toast.error(error instanceof Error ? error.message : "导出失败"); }
    finally { setDownloading(false); }
  }
  return <div className="grid items-start gap-6 lg:grid-cols-[320px_1fr]">
    <section className="panel space-y-6 p-6 sm:p-8"><div className="flex flex-col items-center text-center"><div className="mb-4 flex size-24 overflow-hidden rounded-full bg-[var(--canvas)] text-[var(--accent)]">{user.avatar_url ? <img src={user.avatar_url} alt="个人头像" className="size-full object-cover" /> : <UserRound className="m-auto" size={38} strokeWidth={1.4} />}</div><h2 className="text-xl font-semibold">{user.username || "PawnSteps 用户"}</h2><p className="mt-1 text-sm text-[var(--muted)]">{user.email || "每一个小步，都算数。"}</p><input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="选择头像图片" onChange={event => { const file = event.target.files?.[0]; if (file) { const data = new FormData(); data.append("file", file); void mutate("/profile/avatar", data).then(() => toast.success("头像已更新")).catch(() => undefined); } event.target.value = ""; }} /><Button className="mt-5" variant="outline" size="sm" disabled={busy} onClick={() => avatarInput.current?.click()}><Upload size={16} />更换头像</Button></div>
      <dl className="grid grid-cols-2 gap-5 border-y border-[var(--line)] py-6">{[["累计经验", `${stats.xp} XP`], ["完成目标", `${stats.completed} 个`], ["连续打卡", `${stats.streak} 天`], ["正在积累", `${stats.in_progress} 个`]].map(([label, value]) => <div key={label}><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}</dl>
      <p className="text-center text-xs text-[var(--muted)]">加入于 {new Date(user.created_at).toLocaleDateString("zh-CN")}</p><Button variant="ghost" className="w-full" disabled={busy} onClick={() => void logout()}><LogOut size={16} />退出登录</Button>
    </section>
    <div className="space-y-6"><section className="panel p-6 sm:p-8"><h2 className="text-lg font-semibold">个人资料</h2><p className="mt-1 text-sm text-[var(--muted)]">让这个小小的成长空间，更像你。</p><form className="mt-6 space-y-4" onSubmit={event => { event.preventDefault(); const parsed = username.safeParse(displayName); if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; } void mutate("/profile", { username: displayName }, "PATCH").then(() => toast.success("个人资料已保存")).catch(() => undefined); }}><label className="block space-y-2 text-sm font-medium">用户名<Input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="username" /></label><Button disabled={busy || displayName === user.username} type="submit">保存资料<Check size={16} /></Button></form></section>
      <section className="panel p-6 sm:p-8"><h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound size={19} />{user.has_password ? "修改密码" : "设置登录密码"}</h2><p className="mt-1 text-sm text-[var(--muted)]">更新后，其他设备上的旧登录会失效。</p><form className="mt-6 space-y-4" onSubmit={handleSubmit(async data => { try { await mutate("/profile/password", { ...data, current_password: data.current_password || null }); reset(); toast.success("密码已更新"); } catch {} })}>{user.has_password && <label className="block space-y-2 text-sm font-medium">当前密码<Input type="password" autoComplete="current-password" required {...register("current_password")} /></label>}<label className="block space-y-2 text-sm font-medium">新密码<Input type="password" autoComplete="new-password" placeholder="至少 10 个字符" {...register("new_password")} /><ErrorText text={errors.new_password?.message} /></label><Button variant="outline" disabled={busy} type="submit">{user.has_password ? "更新密码" : "设置密码"}</Button></form></section>
      <section className="panel flex flex-wrap items-center justify-between gap-5 p-6 sm:p-8"><div><h2 className="text-lg font-semibold">带走你的每一步</h2><p className="mt-1 text-sm text-[var(--muted)]">导出任务、奖励与完整打卡记录。</p></div><Button variant="outline" disabled={downloading} onClick={() => void downloadData()}><Download size={17} />{downloading ? "正在导出…" : "导出数据"}</Button></section>
    </div>
  </div>;
}

export function AccountPanel() {
  const user = useAppStore(state => state.user);
  const [mode, setMode] = useState<SignInMode>("password");
  if (user) return <Profile />;
  const tabs: [SignInMode, string][] = [["password", "账号登录"], ["email", "邮箱验证码"], ["wechat", "微信扫码"], ["register", "注册"]];
  return <div className="grid items-start gap-8 xl:grid-cols-[0.8fr_1fr]"><section className="px-1 py-5 sm:p-6"><span className="eyebrow">YOUR PERSONAL SPACE</span><h2 className="mt-4 max-w-sm text-3xl font-semibold leading-snug">为每一份坚持，<br />留一个长久的位置。</h2><p className="mt-5 max-w-sm text-base leading-8 text-[var(--muted)]">登录后，在不同设备继续你的计划。游客模式里的小小积累，也可以一起带过来。</p><div className="mt-8 flex items-start gap-3 text-sm leading-6 text-[var(--muted)]"><ShieldCheck className="shrink-0 text-[var(--success)]" size={21} /><p>每个账号都有独立的数据空间。<br />你的计划，只属于你。</p></div></section><section className="panel p-5 sm:p-8"><div role="tablist" aria-label="登录方式" className="mb-7 flex flex-wrap gap-1 rounded-xl bg-[var(--canvas)] p-1">{tabs.map(([key, label]) => <button role="tab" id={`auth-tab-${key}`} aria-controls={`auth-panel-${key}`} aria-selected={mode === key} tabIndex={mode === key ? 0 : -1} type="button" key={key} onClick={() => setMode(key)} onKeyDown={event => { const index = tabs.findIndex(([value]) => value === mode); const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1; if (next >= 0) { event.preventDefault(); const value = tabs[next][0]; setMode(value); document.getElementById(`auth-tab-${value}`)?.focus(); } }} className={`min-h-11 flex-1 cursor-pointer whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${mode === key ? "bg-[var(--surface)] font-semibold text-[var(--text)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--text)]"}`}>{label}</button>)}</div><div role="tabpanel" id={`auth-panel-${mode}`} aria-labelledby={`auth-tab-${mode}`} key={mode}>{mode === "password" ? <PasswordSignIn /> : mode === "register" ? <Register /> : mode === "email" ? <EmailSignIn /> : <WechatSignIn />}</div></section></div>;
}
