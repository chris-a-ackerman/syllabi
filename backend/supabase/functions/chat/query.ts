// Pure query-analysis helpers for the chat function. No I/O — everything here
// is deterministic given its inputs, so it is unit-tested in tests/unit/.

export function detectQueryType(message: string): string {
  const lower = message.toLowerCase();
  const dateKeywords = ["due", "today", "tomorrow", "this week", "next week", "monday", "tuesday", "wednesday", "thursday", "friday", "deadline", "exam", "quiz", "when is", "what's on"];
  const scheduleKeywords = ["class", "meet", "miss", "skip class", "office hours", "location", "room"];
  const gradingKeywords = ["worth", "grade", "points", "percent", "drop", "weight", "gpa", "final grade", "can i skip", "need on"];
  const policyKeywords = ["late", "policy", "ai", "artificial intelligence", "extra credit", "attendance", "absence", "extension", "integrity", "cheat"];
  if (dateKeywords.some(k => lower.includes(k))) return "date";
  if (policyKeywords.some(k => lower.includes(k))) return "policy";
  if (gradingKeywords.some(k => lower.includes(k))) return "grading";
  if (scheduleKeywords.some(k => lower.includes(k))) return "schedule";
  return "general";
}

export function extractDateRange(message: string, today: Date = new Date()): { start: string; end: string; isSpecific: boolean } {
  const lower = message.toLowerCase();
  const todayStr = today.toISOString().split("T")[0];

  // Check multi-word phrases FIRST — "next week" and "this week" must be matched
  // before "today" so that messages like "What's due next week? Today is March 5th"
  // don't erroneously collapse to a single-day range.
  if (lower.includes("next week")) {
    const start = new Date(today); start.setDate(today.getDate() + (7 - today.getDay() + 1));
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0], isSpecific: true };
  }
  if (lower.includes("this week")) {
    const end = new Date(today); end.setDate(today.getDate() + (7 - today.getDay()));
    return { start: todayStr, end: end.toISOString().split("T")[0], isSpecific: true };
  }
  if (lower.includes("tomorrow")) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    const s = d.toISOString().split("T")[0];
    return { start: s, end: s, isSpecific: true };
  }
  if (lower.includes("today")) return { start: todayStr, end: todayStr, isSpecific: true };

  // No specific time keyword — caller should fall back to semester-wide range
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
  return { start: todayStr, end: nextWeek.toISOString().split("T")[0], isSpecific: false };
}

// deno-lint-ignore no-explicit-any
export function buildCourseContext(courses: any[], events: any[], queryType: string): string {
  if (!courses.length) return "No courses found for this query.";

  const courseSections = courses.map(c => {
    const header = `${c.name}${c.code ? ` (${c.code})` : ""}${c.professor ? ` — Prof. ${c.professor}` : ""}`;

    // Schedule
    const s = c.schedule || {};
    const days = (s.meeting_days || []).join(", ") || "TBD";
    const time = s.meeting_time ? `${s.meeting_time.start || ""}–${s.meeting_time.end || ""}` : "TBD";
    const schedule = `Meets: ${days} ${time} at ${s.location || "TBD"}`;

    // Grading
    const rules = c.grading_rules || {};
    // deno-lint-ignore no-explicit-any
    const components = (rules.components || []).map((comp: any) =>
      `  - ${comp.name}: ${comp.weight}%${comp.drop_lowest ? ` (drop lowest ${comp.drop_lowest})` : ""}${comp.late_policy ? `, late: ${comp.late_policy}` : ""}`
    ).join("\n");
    const grading = components
      ? `${components}${rules.grading_scale ? `\n  Scale: ${rules.grading_scale}` : ""}`
      : "  Not available.";

    // Policies — all fields including other[]
    const p = c.policies || {};
    const policyLines = [
      p.attendance         ? `  Attendance: ${p.attendance}` : null,
      p.late_work          ? `  Late work: ${p.late_work}` : null,
      p.academic_integrity ? `  Academic integrity: ${p.academic_integrity}` : null,
      p.ai_policy          ? `  AI policy: ${p.ai_policy}` : null,
      p.technology         ? `  Technology: ${p.technology}` : null,
      p.recording          ? `  Recording: ${p.recording}` : null,
      ...(Array.isArray(p.other) ? p.other.map((o: string) => `  Other: ${o}`) : []),
    ].filter(Boolean);
    const policies = policyLines.length ? policyLines.join("\n") : "  Not available.";

    return `### ${header}\n**Schedule:** ${schedule}\n**Grading:**\n${grading}\n**Policies:**\n${policies}`;
  });

  const eventLabel = queryType === "date" ? "Events in requested date range" : "Upcoming events (next 30 days)";
  const eventsSection = events.length
    ? events.map(e => {
        const course = e.courses ? ` [${e.courses.code || e.courses.name}]` : "";
        const time = e.time ? ` at ${e.time}` : "";
        const low = e.confidence === "low" ? " (date approximate)" : "";
        return `- ${e.date}${time}${course}: ${e.title} (${e.type})${low}`;
      }).join("\n")
    : "  None found.";

  return `${courseSections.join("\n\n")}\n\n**${eventLabel}:**\n${eventsSection}`;
}
