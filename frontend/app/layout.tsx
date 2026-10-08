import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "PawnSteps 日拱一卒", description: "把大目标拆成小步，让每一天都有向前的痕迹。", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F6F3EC" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('pawnsteps-theme');document.documentElement.classList.toggle('dark',t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))}catch(e){}` }} /></head><body>{children}</body></html>;
}
