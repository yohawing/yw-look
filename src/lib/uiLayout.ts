const KEY = "yw-look:ui-layout";

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

export function clampSelectedPercent(value: number) {
  return Math.min(75, Math.max(20, Number.isFinite(value) ? value : 38));
}

export function loadUiLayout() {
  const defaults = {
    sidebarOpen: typeof window === "undefined" || window.innerWidth >= 720,
    sidebarWidth: clampSidebarWidth(350),
    selectedPercent: 38,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const value = JSON.parse(raw);
    if (
      value?.schemaVersion !== 1 ||
      typeof value.sidebar?.open !== "boolean" ||
      !Number.isFinite(value.sidebar?.widthPx) ||
      !Number.isFinite(value.hierarchy?.selectedPercent)
    ) {
      localStorage.removeItem(KEY);
      return defaults;
    }
    return {
      sidebarOpen: value.sidebar.open,
      sidebarWidth: clampSidebarWidth(value.sidebar.widthPx),
      selectedPercent: clampSelectedPercent(value.hierarchy.selectedPercent),
    };
  } catch {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* Storage may be disabled. */
    }
    return defaults;
  }
}

export function saveUiLayout(state: {
  sidebarOpen: boolean;
  sidebarWidth: number;
  selectedPercent: number;
}) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schemaVersion: 1,
        sidebar: { open: state.sidebarOpen, widthPx: state.sidebarWidth },
        hierarchy: { selectedPercent: state.selectedPercent },
      }),
    );
  } catch {
    /* Keep the UI usable when storage is unavailable. */
  }
}
