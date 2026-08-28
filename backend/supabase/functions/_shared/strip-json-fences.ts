// Strip accidental markdown code fences (and any preamble before them) from a
// Claude response that should have been raw JSON. A response with no fences
// passes through unchanged apart from trimming.
export function stripJsonFences(raw: string): string {
  return raw
    .replace(/^[\s\S]*?```json\n?/, "") // remove everything up to and including ```json
    .replace(/\n?```[\s\S]*$/, "") // remove ``` and everything after
    .trim();
}
