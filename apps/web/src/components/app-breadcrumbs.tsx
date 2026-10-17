import { Link, useLocation } from "@tanstack/react-router";
import { Breadcrumb } from "antd";
import type { ItemType } from "antd/es/breadcrumb/Breadcrumb";

/** Static crumbs for known top-level business destinations. */
const TOP_LEVEL: Record<string, { group: string; label: string }> = {
  "/dashboard": { group: "总览", label: "审计驾驶舱" },
  "/demo": { group: "总览", label: "演示概览" },
  "/audit-cases": { group: "审计作业", label: "审计队列" },
  "/audit-runs": { group: "审计作业", label: "运行轨迹" },
  "/reviews": { group: "审计作业", label: "复核中心" },
  "/remediations": { group: "审计作业", label: "整改跟踪" },
  "/contracts": { group: "审计作业", label: "合同中心" },
  "/dossier-review": { group: "审计作业", label: "卷宗核对" },
  "/rules": { group: "规则治理", label: "规则管理" },
  "/cases": { group: "规则治理", label: "案例验证" },
  "/verification": { group: "能力与集成", label: "外部核验" },
  "/integrations": { group: "能力与集成", label: "集成健康" },
  "/settings/providers": { group: "系统管理", label: "模型服务" },
  "/settings/ocr": { group: "系统管理", label: "OCR 识别" },
};

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Path-driven breadcrumbs for the shell header. Old deep links stay valid;
 * crumbs only describe the current path and never invent unfinished routes.
 */
export function AppBreadcrumbs() {
  const { pathname } = useLocation();
  const items = buildCrumbs(pathname);
  return <Breadcrumb className="app-breadcrumbs" items={items} aria-label="面包屑" />;
}

function buildCrumbs(pathname: string): ItemType[] {
  const top = TOP_LEVEL[pathname];
  if (top) {
    return [{ title: top.group }, { title: top.label }];
  }

  // Nested case workspace: /audit-cases/:id[/trace|/decisions]
  const caseMatch = pathname.match(/^\/audit-cases\/([^/]+)(?:\/(trace|decisions))?$/);
  if (caseMatch) {
    const id = caseMatch[1] ?? "";
    const leaf = caseMatch[2];
    const crumbs: ItemType[] = [
      { title: "审计作业" },
      { title: <Link to="/audit-cases">审计队列</Link> },
      {
        title: leaf ? (
          <Link to="/audit-cases/$id" params={{ id }}>
            案件 {shortId(id)}
          </Link>
        ) : (
          `案件 ${shortId(id)}`
        ),
      },
    ];
    if (leaf === "trace") crumbs.push({ title: "执行轨迹" });
    if (leaf === "decisions") crumbs.push({ title: "决策建议" });
    return crumbs;
  }

  const ruleMatch = pathname.match(/^\/rules\/([^/]+)$/);
  if (ruleMatch) {
    const id = ruleMatch[1] ?? "";
    return [
      { title: "规则治理" },
      { title: <Link to="/rules">规则管理</Link> },
      { title: `规则 ${shortId(id)}` },
    ];
  }

  const contractMatch = pathname.match(/^\/contracts\/([^/]+)$/);
  if (contractMatch) {
    const id = contractMatch[1] ?? "";
    return [
      { title: "审计作业" },
      { title: <Link to="/contracts">合同中心</Link> },
      { title: `合同 ${shortId(id)}` },
    ];
  }

  // Unknown path: still show something useful without inventing nav entries.
  return [{ title: "总览" }, { title: pathname || "/" }];
}
