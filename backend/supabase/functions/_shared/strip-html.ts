// Flatten an HTML fragment to plain text: tags → spaces, whitespace collapsed.
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
