export type TextMatch = { pageNumber: number; start: number; end: number; preview: string };

// Identical offsets for the search index and the visible PDF.js text layer.
export function joinPdfText(strings: string[]) {
  let text = "";
  const offsets = strings.map((str) => {
    if (text && str && !/\s$/.test(text) && !/^\s/.test(str)) text += " ";
    const start = text.length;
    text += str;
    return start;
  });
  return { text, offsets };
}

export function findTextMatches(text: string, query: string, pageNumber: number): TextMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return Array.from(text.matchAll(new RegExp(escaped, "giu")), (match) => ({
    pageNumber, start: match.index!, end: match.index! + match[0].length,
    preview: text.slice(Math.max(0, match.index! - 35), match.index! + match[0].length + 65),
  }));
}
