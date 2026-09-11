import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { AuditOutlined, MenuOutlined } from "@ant-design/icons";
import { Button, Drawer } from "antd";
import { getApiHealth } from "../api";
import { useMediaQuery } from "../hooks/use-media-query";

const healthLabels = {
  checking: "正在检查服务",
  ok: "服务正常",
  unavailable: "服务不可用",
} as const;

function HealthIndicator({ health }: { health: keyof typeof healthLabels }) {
  return (
    <span
      className={`health-indicator health-indicator--${health}`}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className="health-indicator__dot" />
      {healthLabels[health]}
    </span>
  );
}

function AppNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="主导航">
      <Link
        className="app-nav-link"
        to="/audit-cases"
        activeProps={{ "aria-current": "page" }}
        onClick={onNavigate}
      >
        <AuditOutlined aria-hidden="true" />
        <span>审计工作台</span>
      </Link>
    </nav>
  );
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const healthQuery = useQuery({
    queryKey: ["api-health"],
    queryFn: getApiHealth,
    refetchInterval: 30_000,
  });
  const health = healthQuery.data ?? "checking";

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="app-brand" to="/audit-cases" aria-label="合同审计工作台首页">
          <span className="app-brand-mark" aria-hidden="true">审</span>
          <span>Contract Audit</span>
        </Link>
        {isMobile ? (
          <div className="app-sidebar-actions">
            <HealthIndicator health={health} />
            <Button
              className="app-menu-trigger"
              type="text"
              icon={<MenuOutlined aria-hidden="true" />}
              aria-label="打开菜单"
              onClick={() => setMenuOpen(true)}
            />
          </div>
        ) : (
          <AppNav />
        )}
      </aside>
      <div className="app-frame">
        <header className="app-header" role="banner">
          <span className="app-header-title">合同审计工作台</span>
          {!isMobile && <HealthIndicator health={health} />}
        </header>
        <main className="app-main"><Outlet /></main>
      </div>
      {isMobile && (
        <Drawer
          title="合同审计工作台"
          placement="left"
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          size="min(280px, 80vw)"
          className="app-menu-drawer"
        >
          <AppNav onNavigate={() => setMenuOpen(false)} />
        </Drawer>
      )}
    </div>
  );
}
