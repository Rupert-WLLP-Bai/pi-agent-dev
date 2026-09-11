import type { ThemeConfig } from "antd";

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: "#18181b",
    colorInfo: "#0369a1",
    colorSuccess: "#15803d",
    colorWarning: "#a16207",
    colorError: "#b91c1c",
    colorText: "#18181b",
    colorTextSecondary: "#71717a",
    colorBorder: "#e4e4e7",
    colorBgLayout: "#f7f8fa",
    colorBgContainer: "#ffffff",
    borderRadius: 6,
    borderRadiusLG: 10,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontSize: 14,
    lineHeight: 1.5,
    controlHeight: 36,
  },
  components: {
    Button: { primaryShadow: "none", defaultShadow: "none" },
    Card: { boxShadow: "none", boxShadowTertiary: "none" },
    Table: { headerBg: "#fafafa", headerColor: "#71717a", rowHoverBg: "#fafafa" },
  },
};
