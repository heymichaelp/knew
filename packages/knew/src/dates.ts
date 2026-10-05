/**
 * "2025", "2025-09" or "2025-09-14" → a UTC date; anything else → null. The
 * model is told these three shapes; everything it invents instead is dropped
 * rather than guessed at.
 */
export function parseLooseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month = "01", day = "01"] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

export const monthOf = (date: Date): string => date.toISOString().slice(0, 7);
