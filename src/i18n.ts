import { useSyncExternalStore } from "react";
import english from "./locales/en.json";

export type UiLanguage = "ru" | "en";
const dictionary: Record<string, string> = english;
const russian = new Map(Object.entries(dictionary).map(([ru, en]) => [en, ru]));
const patterns = Object.entries(dictionary).filter(([key]) => /[А-Яа-яЁё]/.test(key) && /\{\d+\}/.test(key))
  .sort(([a], [b]) => b.length - a.length).map(([ru, en]) => {
    const positions: number[] = [];
    const expression = ru.split(/(\{\d+\})/).map((part) => {
      if (/^\{\d+\}$/.test(part)) { positions.push(Number(part.slice(1, -1))); return "(.+?)"; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    return { expression: new RegExp(`^${expression}$`), en, positions };
  });
let language: UiLanguage = (() => { try { return localStorage.getItem("llr-language") === "en" ? "en" : "ru"; } catch { return "ru"; } })();
const listeners = new Set<() => void>();
export function setUiLanguage(value: UiLanguage) {
  const changed = language !== value;
  language = value;
  document.documentElement.lang = value;
  try { localStorage.setItem("llr-language", value); } catch { /* Desktop settings persist the preference. */ }
  if (changed) listeners.forEach((listener) => listener());
}
export function useUiLanguage() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => language);
}
export const locale = () => language === "en" ? "en-US" : "ru-RU";
function interpolate(source: string, values: unknown[]) {
  return source.replace(/\{(\d+)\}/g, (placeholder, index) => index in values ? String(values[index]) : placeholder);
}
export function t(source: string, values: unknown[] = []): string {
  const key = source.replace(/\s+/g, " ").trim();
  if (language === "ru") return interpolate(russian.get(key) ?? source, values);
  if (dictionary[key]) return interpolate(dictionary[key], values);
  // Queue phases and backend diagnostics can arrive already interpolated.
  for (const pattern of patterns) {
    const match = key.match(pattern.expression);
    if (!match) continue;
    const captured: string[] = [];
    pattern.positions.forEach((position, index) => { captured[position] = match[index + 1]; });
    return interpolate(pattern.en, captured);
  }
  const diagnostic = key.match(/^([A-Z_]+): (.+)$/);
  if (diagnostic) return `${diagnostic[1]}: ${t(diagnostic[2])}`;
  return interpolate(source, values);
}
