// WordPress.org profile handles. People paste all of these:
//   sajid            @sajid            SAJID
//   profiles.wordpress.org/sajid       https://profiles.wordpress.org/sajid/
// All of them mean the same account, so normalise before storing.

const VALID = /^[a-z0-9][a-z0-9._-]{0,58}[a-z0-9]$|^[a-z0-9]$/;

export function normalizeWpUsername(raw: string): string {
  let v = raw.trim();
  if (!v) return "";

  // Pull the handle out of a profile URL, with or without a scheme.
  const url = v.match(/profiles\.wordpress\.org\/+([^/?#\s]+)/i);
  if (url) v = url[1];

  v = v.replace(/^@+/, "").replace(/\/+$/, "").trim().toLowerCase();
  return v;
}

/** Null when empty (the field is optional), otherwise a reason or null. */
export function wpUsernameError(normalized: string): string | null {
  if (!normalized) return null;
  if (normalized.length > 60) return "That is longer than 60 characters.";
  if (!VALID.test(normalized)) {
    return "Use letters, numbers, dots, hyphens or underscores.";
  }
  return null;
}
