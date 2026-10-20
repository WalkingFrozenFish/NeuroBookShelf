import { setUiLanguage, type UiLanguage } from "./i18n";
export const modes = [
  { id: "light", label: "Светлый" },
  { id: "dark", label: "Тёмный" },
] as const;

export const accents = [
  { id: "blue", label: "Синий", hue: 215 },
  { id: "teal", label: "Бирюзовый", hue: 178 },
  { id: "green", label: "Зелёный", hue: 145 },
  { id: "violet", label: "Фиолетовый", hue: 265 },
  { id: "rose", label: "Розовый", hue: 340 },
  { id: "amber", label: "Янтарный", hue: 30 },
] as const;

export const pdfAppearances = [
  { id: "original", label: "Оригинал" },
  { id: "dimmed", label: "Приглушённый" },
  { id: "night", label: "Ночной" },
] as const;

export type Appearance = {
  language?: UiLanguage;
  mode: (typeof modes)[number]["id"];
  accent: (typeof accents)[number]["id"] | "custom";
  customColor?: string;
  pdf: (typeof pdfAppearances)[number]["id"];
};

export const defaultAppearance: Appearance = { mode: "light", accent: "blue", pdf: "original" };

export function normalizeAppearance(value: Partial<Appearance> | null): Appearance {
  return {
    language: value?.language === "en" ? "en" : "ru",
    mode: value?.mode === "dark" ? "dark" : "light",
    customColor: /^#[0-9a-f]{6}$/i.test(value?.customColor ?? "") ? value!.customColor : "#3875c7",
    accent: value?.accent === "custom" ? "custom" : accents.find((item) => item.id === value?.accent)?.id ?? "blue",
    pdf: pdfAppearances.find((item) => item.id === value?.pdf)?.id ?? "original",
  };
}

export function cachedAppearance(): Appearance {
  try {
    const cached = localStorage.getItem("llr-appearance");
    if (cached) return normalizeAppearance(JSON.parse(cached));
    const legacy = localStorage.getItem("llr-theme");
    return {
      mode: legacy === "dark" ? "dark" : "light",
      accent: legacy === "sage" ? "green" : legacy === "rose" ? "rose" : legacy === "mist" ? "teal" : "blue",
      pdf: "original",
    };
  } catch {
    return { ...defaultAppearance };
  }
}

export function applyAppearance(value: Appearance) {
  const appearance = normalizeAppearance(value);
  setUiLanguage(appearance.language ?? "ru");
  const root = document.documentElement;
  root.dataset.theme = appearance.mode;
  root.dataset.accent = appearance.accent;
  root.dataset.pdf = appearance.pdf;
  if (appearance.accent === "custom") {
    const hex = appearance.customColor ?? "#3875c7";
    const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    const hue = delta === 0 ? 215 : ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
    root.style.setProperty("--hue", String(hue));
  } else { root.style.removeProperty("--hue"); }
  try {
    localStorage.setItem("llr-appearance", JSON.stringify(appearance));
  } catch {
    // The settings file remains authoritative when the browser cache is unavailable.
  }
}
