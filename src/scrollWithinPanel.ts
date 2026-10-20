// scrollIntoView also scrolls overflow:hidden ancestors. Move only the intended
// panel so search hits and thumbnails cannot shift the application shell.
export function scrollWithinPanel(element: HTMLElement, panel: HTMLElement) {
  const target = element.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  const top = bounds.top + panel.clientTop;
  const left = bounds.left + panel.clientLeft;
  const bottom = top + panel.clientHeight;
  const right = left + panel.clientWidth;
  const y = target.top < top ? target.top - top : target.bottom > bottom ? target.bottom - bottom : 0;
  const x = target.left < left ? target.left - left : target.right > right ? target.right - right : 0;
  if (x || y) panel.scrollBy({ left: x, top: y, behavior: "instant" });
}
