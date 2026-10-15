import {
  ApiOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  NodeIndexOutlined,
  ScanOutlined,
  SettingOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import type { MenuProps } from "antd";
import { Avatar, Button, Drawer, Layout, Menu, Tooltip } from "antd";
import { useState } from "react";
import { getApiHealth } from "../api";
import { useMediaQuery } from "../hooks/use-media-query";
import { readOperator } from "../operator";
import { sessionAllowsQueries, useSession, useSessionActions } from "../session";
import { AccessGate } from "./access-gate";

const { Sider, Header, Content } = Layout;

const COLLAPSE_PREF_KEY = "contract-audit:sider-collapsed";

const healthLabels = {
  checking: "正在检查服务",
  ok: "服务正常",
  unavailable: "服务不可用",
} as const;

/** Org mark, product name, and contest badge stacked as one lockup. */
export function BrandMark({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="brand-collapsed" title="合同智能审计智能体">
        <span className="brand-collapsed-mark" aria-hidden="true">
          审
        </span>
      </div>
    );
  }
  return (
    <div className="brand-lockup">
      <div className="brand-main">
        <span className="brand-org-plate">
          <img
            src="/brands/chinamobileltd-com-logo.png"
            alt=""
            aria-hidden="true"
            className="brand-org-logo"
            onError={(event) => {
              // Never leave an empty plate if the asset is missing.
              event.currentTarget.parentElement?.classList.add("brand-org-plate--missing");
              event.currentTarget.remove();
            }}
          />
        </span>
        <span className="brand-title">
          <span className="brand-product-name">合同智能审计智能体</span>
          <span className="brand-org-name">中国移动</span>
        </span>
      </div>
      <div className="brand-contest">
        <img
          src="/brands/hjs.png"
          alt=""
          aria-hidden="true"
          className="brand-contest-logo"
          onError={(event) => {
            event.currentTarget.remove();
          }}
        />
        <span>第一届黄桷树AI智能体开发大赛</span>
      </div>
    </div>
  );
}

const navGroups: MenuProps["items"] = [
  {
    type: "group",
    label: "总览",
    children: [
      {
        key: "/dashboard",
        icon: <DashboardOutlined />,
        label: <Link to="/dashboard">审计驾驶舱</Link>,
      },
      {
        key: "/demo",
        icon: <AuditOutlined />,
        label: <Link to="/demo">演示概览</Link>,
      },
    ],
  },
  {
    type: "group",
    label: "审计作业",
    children: [
      {
        key: "/audit-cases",
        icon: <AuditOutlined />,
        label: <Link to="/audit-cases">审计队列</Link>,
      },
      {
        key: "/contracts",
        icon: <FileTextOutlined />,
        label: <Link to="/contracts">合同中心</Link>,
      },
      {
        key: "/dossier-review",
        icon: <FolderOpenOutlined />,
        label: <Link to="/dossier-review">卷宗核对</Link>,
      },
      {
        key: "/audit-runs",
        icon: <NodeIndexOutlined />,
        label: <Link to="/audit-runs">运行轨迹</Link>,
      },
      {
        key: "/reviews",
        icon: <CheckCircleOutlined />,
        label: <Link to="/reviews">复核中心</Link>,
      },
      {
        key: "/remediations",
        icon: <SyncOutlined />,
        label: <Link to="/remediations">整改跟踪</Link>,
      },
    ],
  },
  {
    type: "group",
    label: "规则治理",
    children: [
      {
        key: "/rules",
        icon: <SettingOutlined />,
        label: <Link to="/rules">规则管理</Link>,
      },
      {
        key: "/cases",
        icon: <DatabaseOutlined />,
        label: <Link to="/cases">案例验证</Link>,
      },
    ],
  },
  {
    type: "group",
    label: "能力与集成",
    children: [
      {
        key: "/verification",
        icon: <LinkOutlined />,
        label: <Link to="/verification">外部核验</Link>,
      },
      {
        key: "/integrations",
        icon: <ApiOutlined />,
        label: <Link to="/integrations">集成健康</Link>,
      },
    ],
  },
  {
    type: "group",
    label: "系统管理",
    children: [
      {
        key: "/settings/providers",
        icon: <SettingOutlined />,
        label: <Link to="/settings/providers">模型服务</Link>,
      },
      {
        key: "/settings/ocr",
        icon: <ScanOutlined />,
        label: <Link to="/settings/ocr">OCR 识别</Link>,
      },
      {
        key: "/api/docs",
        icon: <FileTextOutlined />,
        label: (
          <a href="/api/openapi" target="_blank" rel="noreferrer">
            接口文档
          </a>
        ),
      },
    ],
  },
];

function readStoredCollapse(): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(COLLAPSE_PREF_KEY);
  return raw === null ? null : raw === "true";
}

/** The raw `origin` search param, read without trusting an unvalidated shape. */
function readOrigin(search: unknown): unknown {
  return search !== null && typeof search === "object" && "origin" in search
    ? search.origin
    : undefined;
}

function selectedKeys(pathname: string, origin?: unknown): string[] {
  if (pathname === "/" || pathname === "/dashboard") return ["/dashboard"];
  if (pathname === "/demo") return ["/demo"];
  // A contract's detail page is the same section as the contract list: the nav
  // must keep 合同中心 highlighted while a detail is open.
  if (pathname === "/contracts" || pathname.startsWith("/contracts/")) return ["/contracts"];
  // A case's detail page and its trace page are both the queue section: the
  // nav must keep highlighting where the operator came from.
  if (pathname.startsWith("/audit-cases")) {
    if (pathname.endsWith("/decisions")) return ["/audit-cases"];
    if (origin === "reviews") return ["/reviews"];
    if (origin === "remediations") return ["/remediations"];
    return ["/audit-cases"];
  }
  // The rule editor belongs to 规则管理, so the section stays highlighted.
  if (pathname.startsWith("/rules")) return ["/rules"];
  // The two settings pages are siblings under 系统管理.
  if (pathname.startsWith("/settings/")) return [pathname];
  return [pathname];
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(readStoredCollapse);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isTablet = useMediaQuery("(max-width: 1023px)");
  const location = useLocation();
  const origin = readOrigin(location.search);

  const session = useSession();
  const { login, logout } = useSessionActions();
  // Protected queries stay withheld until the gate answers: an unresolved
  // session (still loading, or the endpoint itself failing) must not be read
  // as "no gate", because the server is going to refuse those queries anyway.
  const queriesAllowed = sessionAllowsQueries(session.data);

  const healthQuery = useQuery({
    queryKey: ["api-health"],
    queryFn: getApiHealth,
    refetchInterval: 30_000,
    enabled: queriesAllowed,
  });
  const health = healthQuery.data?.status ?? "checking";
  const showHealth = health !== "ok";

  // The sider narrows to the 64px rail only when the viewport is too narrow for
  // it (§3.3) or the operator collapsed it. The route never changes it, so
  // switching sections stays one click away.
  const effectiveCollapsed = isTablet || (userCollapsed ?? false);

  const toggleCollapsed = () => {
    const next = !effectiveCollapsed;
    setUserCollapsed(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(COLLAPSE_PREF_KEY, String(next));
    }
  };

  const navMenu = (
    <nav aria-label="主导航" className="app-nav">
      <Menu
        mode="inline"
        items={navGroups}
        selectedKeys={selectedKeys(location.pathname, readOrigin(location.search))}
        className="app-sider-menu"
      />
    </nav>
  );

  // The gate renders instead of the shell while a passphrase is required and
  // missing, so no protected query is mounted and no route content is shown.
  if (session.data?.authenticationRequired === true && !session.data.authenticated) {
    return (
      <AccessGate
        pending={login.isPending}
        error={login.error instanceof Error ? login.error.message : null}
        unreachable={session.isError}
        onSubmit={(passphrase) => login.mutate(passphrase)}
      />
    );
  }

  return (
    <Layout className="app-shell">
      {!isMobile && (
        <Sider
          width={232}
          collapsedWidth={64}
          collapsed={effectiveCollapsed}
          theme="dark"
          trigger={null}
          className="app-sider"
        >
          <BrandMark collapsed={effectiveCollapsed} />
          {navMenu}
          <div className="app-sider-foot">
            <div className="app-user-tile">
              <Avatar size={28} style={{ background: "#1D4E79", flexShrink: 0 }}>
                审
              </Avatar>
              {!effectiveCollapsed && (
                <div className="app-user-meta">
                  <b>审计管理员</b>
                  <span>{readOperator()}</span>
                </div>
              )}
            </div>
          </div>
        </Sider>
      )}
      <Layout>
        <Header className="app-header">
          <div className="app-header-left">
            {isMobile ? (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMenuOpen(true)}
                aria-label="打开菜单"
              />
            ) : (
              <Tooltip title={effectiveCollapsed ? "展开侧栏" : "收起侧栏"}>
                <Button
                  type="text"
                  icon={effectiveCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={toggleCollapsed}
                  aria-label={effectiveCollapsed ? "展开侧栏" : "收起侧栏"}
                  aria-expanded={!effectiveCollapsed}
                />
              </Tooltip>
            )}
          </div>
          <div className="app-header-right">
            {showHealth && (
              <span
                className={`health-indicator health-indicator--${health}`}
                role="status"
                aria-live="polite"
              >
                <span aria-hidden="true" className="health-indicator__dot" />
                {healthLabels[health]}
              </span>
            )}
            {session.data?.authenticationRequired === true && session.data.authenticated && (
              <Button
                size="small"
                loading={logout.isPending}
                onClick={() => logout.mutate()}
                aria-label="退出登录"
              >
                退出登录
              </Button>
            )}
            <Avatar size={28} style={{ background: "#1D4E79" }}>
              审
            </Avatar>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
      {isMobile && (
        <Drawer
          title="合同智能审计智能体"
          placement="left"
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          size={260}
          className="app-menu-drawer"
          styles={{ body: { padding: 0, background: "#0F2740" } }}
        >
          <BrandMark collapsed={false} />
          <Menu
            mode="inline"
            items={navGroups}
            selectedKeys={selectedKeys(location.pathname, origin)}
            className="app-sider-menu"
            onClick={() => setMenuOpen(false)}
          />
        </Drawer>
      )}
    </Layout>
  );
}
