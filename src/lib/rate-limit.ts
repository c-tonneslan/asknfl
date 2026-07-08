// Best-effort in-memory per-IP rate limit for the paid Claude endpoints.
// On serverless this is per-instance (not a hard global cap), but it meaningfully
// raises the bar against scripted abuse of ANTHROPIC_API_KEY without pulling in a
// Redis/KV dependency for a demo app.
const WINDOW_MS = 60_000;
const DEFAULT_MAX = 20;
const hits = new Map<string, number[]>();

export function rateLimited(ip: string, max = DEFAULT_MAX): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude unbounded-growth guard
  return recent.length > max;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
