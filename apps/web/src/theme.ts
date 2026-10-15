import type { ThemeConfig } from "antd";

/**
 * Enterprise light theme: deep navy primary, slate text ramp, soft blue-grey
 * layout surfaces. Hex values mirror the semantic tokens in styles.css; keep
 * the two in sync when adjusting either.
 */
export const appTheme: ThemeConfig = {
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
    borderRadius: 6,
    borderRadiusLG: 10,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    fontSize: 14,
    lineHeight: 1.55,
    controlHeight: 32,
    boxShadowTertiary: "0 1px 2px rgb(15 23 42 / 5%), 0 1px 3px rgb(15 23 42 / 6%)",
  },
  components: {
    Button: { primaryShadow: "none", defaultShadow: "none", fontWeight: 500 },
    Card: {
      boxShadow: "none",
      boxShadowTertiary: "0 1px 2px rgb(15 23 42 / 5%), 0 1px 3px rgb(15 23 42 / 6%)",
      headerFontSize: 14,
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
    },
    Segmented: { itemSelectedBg: "#FFFFFF" },
    Statistic: { contentFontSize: 26 },
  },
};
