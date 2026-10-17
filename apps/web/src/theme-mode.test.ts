import { afterEach, describe, expect, test } from "bun:test";
import {
  applyThemeModeToDocument,
  DEFAULT_THEME_MODE,
  isThemeMode,
  readStoredThemeMode,
  resolveInitialThemeMode,
  storeThemeMode,
  THEME_MODE_STORAGE_KEY,
} from "./theme-mode";

const memory = new Map<string, string>();

function installStorageMock(): void {
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        dataset: {} as Record<string, string>,
        style: { colorScheme: "" },
      },
    },
  });
}

afterEach(() => {
  memory.clear();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

describe("theme-mode", () => {
  test("default appearance is dark", () => {
    expect(DEFAULT_THEME_MODE).toBe("dark");
    installStorageMock();
    expect(resolveInitialThemeMode()).toBe("dark");
  });

  test("isThemeMode accepts only dark and light", () => {
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("system")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });

  test("stores and reads a chosen mode", () => {
    installStorageMock();
    storeThemeMode("light");
    expect(readStoredThemeMode()).toBe("light");
    expect(resolveInitialThemeMode()).toBe("light");
  });

  test("ignores corrupt stored values", () => {
    installStorageMock();
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, "neon");
    expect(readStoredThemeMode()).toBeNull();
    expect(resolveInitialThemeMode()).toBe("dark");
  });

  test("applyThemeModeToDocument sets data-theme and color-scheme", () => {
    installStorageMock();
    applyThemeModeToDocument("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    applyThemeModeToDocument("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
