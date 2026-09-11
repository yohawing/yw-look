export function clampSidebarWidth(
  value: number,
  viewport = typeof window === "undefined" ? 1200 : window.innerWidth,
) {
  const max = Math.max(
    0,
    Math.min(560, viewport, Math.max(300, Math.floor(viewport * 0.48))),
  );
  const min = Math.min(300, max);
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 350));
}
