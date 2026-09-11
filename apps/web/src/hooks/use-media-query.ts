import { useCallback, useMemo, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const media = useMemo(
    () => typeof window === "undefined" ? null : window.matchMedia(query),
    [query],
  );
  const subscribe = useCallback((notify: () => void) => {
    if (!media) return () => undefined;
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }, [media]);
  const getSnapshot = useCallback(() => media?.matches ?? false, [media]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
