import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { AuditOutlined } from "@ant-design/icons";
import { getApiHealth } from "../api";

export function AppShell() {
  const healthQuery = useQuery({
    queryKey: ["api-health"],
    queryFn: getApiHealth,
    refetchInterval: 30_000,
  });

  const health = healthQuery.data ?? "checking";
  const healthLabel = {
    checking: "正在检查服务",
    ok: "服务正常",
    unavailable: "服务不可用",
  }[health];

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="app-brand" to="/audit-cases" aria-label="合同审计工作台首页">
          <span className="app-brand-mark" aria-hidden="true">审</span>
          <span>Contract Audit</span>
        </Link>
        <nav aria-label="主导航">
          <Link className="app-nav-link" to="/audit-cases" activeProps={{ "aria-current": "page" }}>
            <AuditOutlined aria-hidden="true" />
            <span>审计工作台</span>
          </Link>
        </nav>
      </aside>
      <div className="app-frame">
        <header className="app-header" role="banner">
          <span className="app-header-title">合同审计工作台</span>
          <span
            className={`health-indicator health-indicator--${health}`}
            role="status"
            aria-live="polite"
          >
            <span aria-hidden="true" className="health-indicator__dot" />
            {healthLabel}
          </span>
        </header>
        <main className="app-main"><Outlet /></main>
      </div>
    </div>
  );
}
