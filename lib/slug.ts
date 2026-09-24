/**
 * URL-safe, lowercase, no runs of dashes.
 *
 * Lives here rather than beside the Server Action that uses it because a
 * "use server" module may only export async functions — and because the form
 * shows the result live, so the same code has to run in the browser.
 */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
