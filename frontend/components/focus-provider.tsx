"use client";
import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { useFocusStore } from "@/lib/focus-store";
import { useAppStore } from "@/lib/store";
import { ownerIdentity } from "@/lib/api";
import { playSound } from "@/lib/audio";
import { clockText, type FocusSession } from "@/lib/focus-types";

export function timerRemaining(session: FocusSession | null, serverNow: string, receivedAt: number) {
  if (!session) return 0;
  if (session.status !== "running" || !session.deadline_at) return session.remaining_seconds;
  return Math.max(0, Math.ceil((Date.parse(session.deadline_at) - Date.parse(serverNow) - (performance.now() - receivedAt)) / 1000));
}
export function useTimerRemaining() {
  const data = useFocusStore(state => state.data);
  const receivedAt = useFocusStore(state => state.receivedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    if (data?.active_session?.status !== "running") return;
    const id = setInterval(() => tick(value => value + 1), 500);
    return () => clearInterval(id);
  }, [data?.active_session?.status]);
  return data ? timerRemaining(data.active_session, data.server_now, receivedAt) : 0;
}
export function FocusProvider() {
  const user = useAppStore(state => state.user);
  const loading = useAppStore(state => state.loading);
  const [identity, setIdentity] = useState("");
  useEffect(() => {
    const store = useFocusStore.getState();
    const owner = ownerIdentity();
    if (store.owner !== owner) store.reset(owner);
    void store.refresh(true);
    let active = true, claiming = false, lastRead = 0, lastClaim = 0;
    const notified = new Set<string>();
    function refresh() { if (!document.hidden) void useFocusStore.getState().refresh(true); }
    const id = setInterval(() => {
      const current = useFocusStore.getState();
      if (ownerIdentity() !== owner) { setIdentity(ownerIdentity()); return; }
      const session = current.data?.active_session;
      if ((session?.status === "running" || !document.hidden) && Date.now() - lastRead > (session?.status === "running" && timerRemaining(session, current.data!.server_now, current.receivedAt) === 0 ? 2000 : 15000)) {
        lastRead = Date.now(); void current.refresh(true);
      }
      if (session?.status === "completed" && !notified.has(session.id) && !claiming && Date.now() - lastClaim > 5000) {
        claiming = true; lastClaim = Date.now();
        void current.write(`/${session.id}/notify`, undefined, { quiet: true, feedback: false }).then(data => {
          if (!active || ownerIdentity() !== owner || !data) return;
          notified.add(session.id);
          if (!data.notification_claimed) return;
          playSound("focus");
          if (localStorage.getItem("pawnsteps-focus-notifications") === "true" && typeof Notification !== "undefined" && Notification.permission === "granted") {
            const notification = new Notification(session.phase === "focus" ? "这一轮专注完成了" : "休息结束了", { body: session.phase === "focus" ? `「${session.task_name}」：回到 PawnSteps 确认这一轮的成果。` : "准备好后，开始下一轮专注。", tag: `pawnsteps-${session.id}`, icon: "/icon.svg" });
            notification.onclick = () => { window.focus(); location.hash = "focus"; notification.close(); };
          }
        }).catch(() => undefined).finally(() => { claiming = false; });
      }
    }, 1000);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pawnsteps-focus") : null;
    if (channel) channel.onmessage = event => {
      const value = event.data, current = useFocusStore.getState().data;
      if (value?.owner === owner && (value.generation !== current?.generation || value.revision > (current?.revision ?? -1))) void useFocusStore.getState().refresh(true);
    };
    const storage = (event: StorageEvent) => { if (event.key === "pawnsteps-token" || event.key === "pawnsteps-guest-id") { useFocusStore.getState().reset(ownerIdentity()); void useFocusStore.getState().refresh(true); } };
    document.addEventListener("visibilitychange", refresh); window.addEventListener("focus", refresh); window.addEventListener("storage", storage);
    return () => { active = false; clearInterval(id); channel?.close(); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); window.removeEventListener("storage", storage); };
  }, [user?.id, loading, identity]);
  return null;
}
export function FocusMini({ onClick }: { onClick: () => void }) {
  const session = useFocusStore(state => state.data?.active_session);
  const remaining = useTimerRemaining();
  if (!session) return null;
  return <button className="focus-mini" onClick={onClick} aria-label="返回专注计时"><Timer size={16} /><span>{session.status === "completed" || session.status === "ended" ? "待确认" : clockText(remaining)}</span>{session.status === "paused" && <small>已暂停</small>}</button>;
}
export function FocusNavLabel() {
  const session = useFocusStore(state => state.data?.active_session);
  const remaining = useTimerRemaining();
  return <span>{session && (session.status === "running" || session.status === "paused") ? clockText(remaining) : "专注计时"}</span>;
}
