/**
 * Appearance mode for the dual-theme design system (M2-A01).
 * Default is dark; light is a complete peer theme, not an afterthought.
 */
export type ThemeMode = "dark" | "light";

export const THEME_MODE_STORAGE_KEY = "contract-audit:theme-mode";

/** The product default when nothing is stored yet. */
export const DEFAULT_THEME_MODE: ThemeMode = "dark";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}

/** Read a previously chosen mode from localStorage; invalid values are ignored. */
export function readStoredThemeMode(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return isThemeMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function storeThemeMode(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // Quota / private mode: theme still applies for this session.
  }
}

/** Resolve the mode that should paint the first frame (storage, else default). */
export function resolveInitialThemeMode(): ThemeMode {
  return readStoredThemeMode() ?? DEFAULT_THEME_MODE;
}

/** Keep CSS custom properties and Ant Design in sync via the document root. */
export function applyThemeModeToDocument(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
}
