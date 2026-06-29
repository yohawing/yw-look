import { useEffect, type MutableRefObject } from "react";

export function useSyncRef<T>(ref: MutableRefObject<T>, value: T) {
  useEffect(() => {
    ref.current = value;
  }, [ref, value]);
}
