export const themes = [
  { id: "light", label: "Светлая" },
  { id: "dark", label: "Тёмная" },
  { id: "sage", label: "Шалфей" },
  { id: "rose", label: "Пыльная роза" },
  { id: "mist", label: "Туман" },
] as const;

export type ThemeId = (typeof themes)[number]["id"];

export function applyTheme(theme: string) {
  const known = themes.some((item) => item.id === theme) ? theme : "light";
  document.documentElement.dataset.theme = known;
  localStorage.setItem("llr-theme", known);
}
