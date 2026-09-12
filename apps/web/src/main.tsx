import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "./app";
import { appTheme } from "./theme";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root is missing from index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={appTheme}>
      <AntApp>
        <AppRouter />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
