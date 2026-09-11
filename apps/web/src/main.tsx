import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { AppRouter } from "./app";
import { appTheme } from "./theme";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={appTheme}>
      <AntApp>
        <AppRouter />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
