const params = new URLSearchParams(window.location.search);
const requestedEntry = params.get("entry") ?? "app";
const entry = import.meta.env.DEV ? requestedEntry : "app";

switch (entry) {
  case "bench":
    document.title = "yw-look load bench";
    await import("./bench/entry");
    break;
  case "selftest":
    document.title = "yw-look selftest";
    document.body.innerHTML = '<pre id="output">running...</pre>';
    await import("./selftest");
    break;
  case "shot":
    document.title = "yw-look shot";
    await import("./shot/entry");
    break;
  default:
    await import("./main");
    break;
}

export {};
