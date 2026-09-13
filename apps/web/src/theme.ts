import type { ThemeConfig } from "antd";

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: "#0B6BB5",
    colorInfo: "#0B5C99",
    colorSuccess: "#15803d",
    colorWarning: "#a16207",
    colorError: "#b91c1c",
    colorText: "#1F2329",
    colorTextSecondary: "#667085",
    colorBorder: "#D9DEE7",
    colorBgLayout: "#F5F7FA",
    colorBgContainer: "#ffffff",
    borderRadius: 8,
    borderRadiusLG: 10,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontSize: 14,
    lineHeight: 1.5,
    controlHeight: 32,
  },
  components: {
    Button: { primaryShadow: "none", defaultShadow: "none" },
    Card: { boxShadow: "none", boxShadowTertiary: "none" },
    Table: { headerBg: "#FAFBFC", headerColor: "#667085", rowHoverBg: "#FAFBFC" },
    Layout: {
      siderBg: "#ffffff",
      headerBg: "#ffffff",
      headerHeight: 56,
    },
    Menu: {
      itemBg: "transparent",
      subMenuItemBg: "transparent",
      itemColor: "#525252",
      itemHoverColor: "#171717",
      itemHoverBg: "#fafafa",
      itemSelectedColor: "#171717",
      itemSelectedBg: "#f5f5f5",
      groupTitleColor: "#737373",
      itemHeight: 36,
    },
  },
};
