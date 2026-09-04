import type { TFunction } from "i18next";

export function apiErrorMessage(t: TFunction, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = raw.replace(/^\d+\s+/, "").trim();
  const key = `errors.${code}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return t("errors.generic", { message: raw });
}
