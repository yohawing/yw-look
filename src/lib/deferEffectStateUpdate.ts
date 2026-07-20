export function deferEffectStateUpdate(update: () => void): () => void {
  let cancelled = false;
  queueMicrotask(() => {
    if (!cancelled) {
      update();
    }
  });
  return () => {
    cancelled = true;
  };
}
