const params = new URLSearchParams(window.location.search);
const requestedEntry = params.get("entry") ?? "app";
const entry =
  requestedEntry === "shot" || requestedEntry === "bench" || import.meta.env.DEV
    ? requestedEntry
    : "app";

function loadFontStylesheet() {
  const href =
    "https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=Source+Code+Pro:wght@400;500;600;700&display=fallback";
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.href = href;
  link.rel = "stylesheet";
  link.media = "print";
  link.addEventListener(
    "load",
    () => {
      link.media = "all";
    },
    { once: true },
  );
  document.head.append(link);
}

switch (entry) {
  case "bench":
    document.title = "yw-look load bench";
    await import("./bench/entry");
    break;
  case "selftest":
    if (!import.meta.env.DEV) break;
    document.title = "yw-look selftest";
    document.body.innerHTML = '<pre id="output">running...</pre>';
    await import("./selftest");
    break;
  case "shot":
    document.title = "yw-look shot";
    await import("./shot/entry");
    break;
  case "sidebar-profile":
    if (!import.meta.env.DEV) break;
    document.title = "yw-look sidebar profile";
    await import("./profile/sidebarIsolationEntry");
    break;
  case "viewport-state-snapshot":
    if (!import.meta.env.DEV) break;
    document.title = "yw-look viewport state snapshot";
    await import("./viewport-state-snapshot/entry");
    break;
  default:
    await import("./main");
    break;
}

loadFontStylesheet();

export {};
