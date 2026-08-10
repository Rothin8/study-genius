const KEY = "solutionai:redirect-after-auth";

/** Only same-origin, absolute app paths are allowed. */
export function sanitizeRedirect(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.startsWith("/auth")) return null;
  return value;
}

export function rememberRedirect(path: string | null | undefined) {
  const safe = sanitizeRedirect(path);
  if (!safe || typeof window === "undefined") return;
  window.sessionStorage.setItem(KEY, safe);
}

export function takeRedirect(fallback = "/chat"): string {
  if (typeof window === "undefined") return fallback;
  const stored = sanitizeRedirect(window.sessionStorage.getItem(KEY));
  window.sessionStorage.removeItem(KEY);
  return stored ?? fallback;
}
