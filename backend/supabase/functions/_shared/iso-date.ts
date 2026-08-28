// Convert an ISO 8601 datetime string to YYYY-MM-DD, or return null
export function isoToDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}
