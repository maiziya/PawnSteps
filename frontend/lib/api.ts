export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function getGuestId() {
  let id = localStorage.getItem("pawnsteps-guest-id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("pawnsteps-guest-id", id); }
  return id;
}
export function headers(): Record<string, string> {
  const token = localStorage.getItem("pawnsteps-token");
  return { "X-Guest-Id": getGuestId(), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options, cache: "no-store", credentials: "same-origin",
    headers: { ...headers(), ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const detail = Array.isArray(error.detail) ? error.detail.map((item: { msg: string }) => item.msg).join("；") : error.detail;
    const fallback: Record<number, string> = { 401: "登录已过期，请重新登录", 403: "当前操作不可用，请检查账号权限", 404: "内容已不存在，请刷新", 409: "数据已发生变化，请刷新后重试", 410: "撤销时间已过", 429: "操作过于频繁，请稍后再试", 503: "此服务尚未配置或暂时不可用" };
    throw new ApiError(detail || fallback[response.status] || "操作未完成，请稍后重试", response.status);
  }
  return response.json() as Promise<T>;
}
