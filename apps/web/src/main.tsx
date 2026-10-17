import { App as AntApp } from "antd";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "./app";
import { applyThemeModeToDocument, resolveInitialThemeMode } from "./theme-mode";
import { ThemeProvider } from "./theme-provider";
import "./styles.css";

// Paint the document theme before React mounts so the first frame matches the
// stored (or default dark) mode and avoids a light flash.
applyThemeModeToDocument(resolveInitialThemeMode());

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root is missing from index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <AntApp>
        <AppRouter />
      </AntApp>
    </ThemeProvider>
  </StrictMode>,
);
