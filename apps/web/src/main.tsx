import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp } from "antd";
import { AppRouter } from "./app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AntApp>
      <AppRouter />
    </AntApp>
  </StrictMode>,
);
