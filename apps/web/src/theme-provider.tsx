import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { themeForMode } from "./theme";
import {
  applyThemeModeToDocument,
  resolveInitialThemeMode,
  storeThemeMode,
  type ThemeMode,
} from "./theme-mode";

interface ThemeModeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => resolveInitialThemeMode());

  useEffect(() => {
    applyThemeModeToDocument(mode);
    storeThemeMode(mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(() => ({ mode, setMode, toggleMode }), [mode, setMode, toggleMode]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={themeForMode(mode)}>
        {children}
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (ctx === null) {
    throw new Error("useThemeMode must be used within ThemeProvider");
  }
  return ctx;
}
