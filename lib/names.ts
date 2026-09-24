/**
 * One casing for names, whatever the sheet said.
 *
 * Two colleges send two sheets and one of them is in block capitals, so the
 * list reads "AARSH HITESH GOPANI" next to "Aastha Vipulbhai Champaneria".
 * Shouting is harder to scan at a gate, and it makes the same list look like
 * two different lists.
 *
 * Two rules keep this from making things worse:
 *
 *   - A word that already mixes cases is left alone. "McDonald" and "D'Souza"
 *     were capitalised deliberately, and flattening them to "Mcdonald" would
 *     be a worse error than the one being fixed.
 *   - Full stops, hyphens and apostrophes separate segments, so "j.p." becomes
 *     "J.P." rather than "J.p." and "jean-paul" becomes "Jean-Paul".
 */
export function titleCaseName(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";

  return t.replace(/[^\s.\-']+/g, (word) => {
    const mixed = /[a-z]/.test(word) && /[A-Z]/.test(word);
    if (mixed) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}
