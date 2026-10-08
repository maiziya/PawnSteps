"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

export default function WechatCallbackPage() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const mutate = useAppStore(state => state.mutate);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ticket = new URLSearchParams(window.location.hash.slice(1)).get("ticket");
    window.history.replaceState({}, "", window.location.pathname);
    if (!ticket) { setError("登录凭证已过期，请重新发起微信登录。"); return; }
    void mutate("/auth/wechat/exchange", { ticket }).then(() => router.replace("/")).catch(value => setError(value instanceof Error ? value.message : "微信登录未完成，请重新尝试。"));
  }, [mutate, router]);
  return <main className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-6"><section className="panel w-full max-w-md p-8 text-center"><ShieldCheck className="mx-auto mb-5 text-[var(--success)]" size={42} strokeWidth={1.5} /><h1 className="text-2xl font-semibold">{error ? "登录暂未完成" : "正在回到你的成长空间"}</h1><p role={error ? "alert" : "status"} className="mt-4 text-sm leading-7 text-[var(--muted)]">{error || "正在安全验证微信授权，即将为你打开今日计划。"}</p>{error && <Button asChild variant="outline" className="mt-6"><Link href="/"><ArrowLeft size={16} />返回日拱一卒</Link></Button>}</section></main>;
}
