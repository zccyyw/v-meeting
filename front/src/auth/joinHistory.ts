export type JoinHistoryEntry = {
  code: string;
  title: string;
  at: number;
};

const STORAGE_KEY = "meeting.joinHistory";
const MAX = 10;

export function getJoinHistory(): JoinHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as JoinHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e) =>
          e &&
          typeof e.code === "string" &&
          e.code.replace(/\D/g, "").length === 9,
      )
      .map((e) => ({
        code: e.code.replace(/\D/g, "").slice(0, 9),
        title: typeof e.title === "string" ? e.title : "",
        at: typeof e.at === "number" ? e.at : 0,
      }));
  } catch {
    return [];
  }
}

export function rememberJoin(codeRaw: string, title: string) {
  const code = codeRaw.replace(/\D/g, "");
  if (code.length !== 9) return;
  const prev = getJoinHistory().filter((e) => e.code !== code);
  const next: JoinHistoryEntry[] = [
    { code, title: title.trim() || code, at: Date.now() },
    ...prev,
  ].slice(0, MAX);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
