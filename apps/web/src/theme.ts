import { theme as antTheme, type ThemeConfig } from "antd";
import type { ThemeMode } from "./theme-mode";

/**
 * Shared shape for both appearance modes. Hex values mirror the semantic
 * tokens in styles.css; keep the two in sync when adjusting either.
 */
const fontFamily =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

const sharedComponents = {
  Button: { primaryShadow: "none", defaultShadow: "none", fontWeight: 500 },
  Card: {
    boxShadow: "none",
    headerFontSize: 14,
  },
  Segmented: {},
  Statistic: { contentFontSize: 26 },
} as const;

/**
 * Complete light theme: enterprise SaaS surfaces (navy text, sky primary).
 * Retained as a full peer of dark mode for M2-A01 acceptance.
 */
export const lightTheme: ThemeConfig = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#0369A1",
    colorInfo: "#0369A1",
    colorLink: "#0369A1",
    colorSuccess: "#15803D",
    colorWarning: "#B45309",
    colorError: "#B91C1C",
    colorText: "#0F172A",
    colorTextSecondary: "#475569",
    colorTextTertiary: "#64748B",
    colorBorder: "#CBD5E1",
    colorBorderSecondary: "#E2E8F0",
    colorBgLayout: "#EEF2F7",
    colorBgContainer: "#FFFFFF",
    colorBgElevated: "#FFFFFF",
    borderRadius: 6,
    borderRadiusLG: 10,
    fontFamily,
    fontSize: 14,
    lineHeight: 1.55,
    controlHeight: 32,
    boxShadowTertiary: "0 1px 2px rgb(15 23 42 / 5%), 0 1px 3px rgb(15 23 42 / 6%)",
  },
  components: {
    ...sharedComponents,
    Card: {
      ...sharedComponents.Card,
      boxShadowTertiary: "0 1px 2px rgb(15 23 42 / 5%), 0 1px 3px rgb(15 23 42 / 6%)",
    },
    Table: {
      headerBg: "#F8FAFC",
      headerColor: "#475569",
      rowHoverBg: "#F1F7FC",
      headerSplitColor: "transparent",
    },
    Layout: {
      siderBg: "#0F2740",
      headerBg: "#FFFFFF",
      headerHeight: 56,
      bodyBg: "#EEF2F7",
    },
    Menu: {
      itemBg: "transparent",
      subMenuItemBg: "transparent",
      itemColor: "#A9BDD3",
      itemHoverColor: "#FFFFFF",
      itemHoverBg: "rgb(255 255 255 / 7%)",
      itemSelectedColor: "#FFFFFF",
      itemSelectedBg: "#0369A1",
      groupTitleColor: "#7A93B1",
      itemHeight: 36,
      itemMarginInline: 8,
      itemBorderRadius: 6,
      activeBarBorderWidth: 0,
      darkItemBg: "transparent",
      darkSubMenuItemBg: "transparent",
      darkItemColor: "#A9BDD3",
      darkItemHoverColor: "#FFFFFF",
      darkItemHoverBg: "rgb(255 255 255 / 7%)",
      darkItemSelectedColor: "#FFFFFF",
      darkItemSelectedBg: "#0369A1",
      darkGroupTitleColor: "#7A93B1",
    },
    Segmented: { itemSelectedBg: "#FFFFFF" },
  },
};

/**
 * Default dark theme: deep navy canvas, elevated slate surfaces, same
 * semantic risk colours adjusted for contrast on dark backgrounds.
 */
export const darkTheme: ThemeConfig = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    colorPrimary: "#38BDF8",
    colorInfo: "#38BDF8",
    colorLink: "#7DD3FC",
    colorSuccess: "#4ADE80",
    colorWarning: "#FBBF24",
    colorError: "#F87171",
    colorText: "#E8EEF6",
    colorTextSecondary: "#A9BDD3",
    colorTextTertiary: "#7A93B1",
    colorBorder: "#2A3F58",
    colorBorderSecondary: "#1E2F44",
    colorBgLayout: "#0B1628",
    colorBgContainer: "#132033",
    colorBgElevated: "#1A2A40",
    borderRadius: 6,
    borderRadiusLG: 10,
    fontFamily,
    fontSize: 14,
    lineHeight: 1.55,
    controlHeight: 32,
    boxShadowTertiary: "0 1px 2px rgb(0 0 0 / 35%), 0 4px 16px rgb(0 0 0 / 28%)",
  },
  components: {
    ...sharedComponents,
    Card: {
      ...sharedComponents.Card,
      boxShadowTertiary: "0 1px 2px rgb(0 0 0 / 35%), 0 4px 16px rgb(0 0 0 / 28%)",
    },
    Table: {
      headerBg: "#0F1C2E",
      headerColor: "#A9BDD3",
      rowHoverBg: "#1A2F48",
      headerSplitColor: "transparent",
    },
    Layout: {
      siderBg: "#07111F",
      headerBg: "#132033",
      headerHeight: 56,
      bodyBg: "#0B1628",
    },
    Menu: {
      itemBg: "transparent",
      subMenuItemBg: "transparent",
      itemColor: "#A9BDD3",
      itemHoverColor: "#FFFFFF",
      itemHoverBg: "rgb(255 255 255 / 7%)",
      itemSelectedColor: "#FFFFFF",
      itemSelectedBg: "#0369A1",
      groupTitleColor: "#7A93B1",
      itemHeight: 36,
      itemMarginInline: 8,
      itemBorderRadius: 6,
      activeBarBorderWidth: 0,
      darkItemBg: "transparent",
      darkSubMenuItemBg: "transparent",
      darkItemColor: "#A9BDD3",
      darkItemHoverColor: "#FFFFFF",
      darkItemHoverBg: "rgb(255 255 255 / 7%)",
      darkItemSelectedColor: "#FFFFFF",
      darkItemSelectedBg: "#0369A1",
      darkGroupTitleColor: "#7A93B1",
    },
    Segmented: { itemSelectedBg: "#1A2A40" },
  },
};

/** @deprecated Prefer lightTheme / darkTheme via ThemeProvider. Kept for imports. */
export const appTheme = lightTheme;

export function themeForMode(mode: ThemeMode): ThemeConfig {
  return mode === "dark" ? darkTheme : lightTheme;
}
