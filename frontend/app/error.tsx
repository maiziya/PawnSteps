"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) { return <main className="standalone panel"><h1>页面暂时遇到问题</h1><p>你的已保存进度仍然保留，请重新加载。</p><button className="btn btn-primary" onClick={reset}>重试</button></main>; }
