export type JoinPrefs = {
  mic: boolean;
  cam: boolean;
};

const STORAGE_KEY = "meeting.joinPrefs";

const DEFAULT_PREFS: JoinPrefs = { mic: false, cam: false };

export function getJoinPrefs(): JoinPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<JoinPrefs>;
    return {
      mic: Boolean(parsed.mic),
      cam: Boolean(parsed.cam),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setJoinPrefs(prefs: JoinPrefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

const PENDING_JOIN_KEY = "meeting.pendingJoin";

export function setPendingJoinCode(code: string) {
  const digits = code.replace(/\D/g, "");
  if (digits.length === 9) {
    sessionStorage.setItem(PENDING_JOIN_KEY, digits);
  }
}

export function takePendingJoinCode(): string | null {
  const raw = sessionStorage.getItem(PENDING_JOIN_KEY);
  sessionStorage.removeItem(PENDING_JOIN_KEY);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

export function peekPendingJoinCode(): string | null {
  const raw = sessionStorage.getItem(PENDING_JOIN_KEY);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

/** Display as "123 456 789"; copy uses digits only. */
export function formatMeetingCode(code: string): string {
  const digits = code.replace(/\D/g, "");
  if (digits.length !== 9) return code;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
