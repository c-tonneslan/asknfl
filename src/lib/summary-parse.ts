// Split the summarize model's "summary --- followups" payload. Tolerant of a
// missing delimiter (whole thing is the summary), stray bullets/numbering, and
// extra blank lines.
export function parseSummary(raw: string): { summary: string; followups: string[] } {
  const text = raw.trim();
  const parts = text.split(/^\s*-{3,}\s*$/m);
  const summary = (parts[0] ?? "").trim();
  const followups = (parts[1] ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 0 && l.length <= 120)
    .slice(0, 3);
  return { summary, followups };
}
