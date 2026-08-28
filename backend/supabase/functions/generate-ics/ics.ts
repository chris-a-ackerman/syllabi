// Pure ICS formatting helpers. No I/O — unit-tested in tests/unit/.

export function formatICSDate(date: string, time: string | null, addHour = false): string {
  if (time) {
    const [h, m] = time.split(":").map(Number);
    const hours = addHour ? String(h + 1).padStart(2, "0") : String(h).padStart(2, "0");
    const dateFormatted = date.replace(/-/g, "");
    return `${dateFormatted}T${hours}${String(m).padStart(2, "0")}00`;
  }
  // All-day event — if addHour (i.e. DTEND), advance to next day per RFC 5545
  if (addHour) {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }
  return date.replace(/-/g, "");
}

export function escapeICS(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
