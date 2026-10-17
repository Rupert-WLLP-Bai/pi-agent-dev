import { describe, expect, test } from "bun:test";

/**
 * Breadcrumb copy for top-level destinations. Kept in sync with
 * AppBreadcrumbs TOP_LEVEL — if labels drift, update both places.
 */
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

describe("breadcrumb labels", () => {
  test("covers the five business nav groups without inventing unfinished routes", () => {
    const groups = new Set(Object.values(TOP_LEVEL).map((item) => item.group));
    expect(groups).toEqual(new Set(["总览", "审计作业", "规则治理", "能力与集成", "系统管理"]));
    expect(TOP_LEVEL["/regulations"]).toBeUndefined();
    expect(TOP_LEVEL["/plugins"]).toBeUndefined();
    expect(TOP_LEVEL["/settings/users"]).toBeUndefined();
  });

  test("dashboard and queue labels stay Chinese", () => {
    expect(TOP_LEVEL["/dashboard"]).toEqual({ group: "总览", label: "审计驾驶舱" });
    expect(TOP_LEVEL["/audit-cases"]).toEqual({ group: "审计作业", label: "审计队列" });
  });
});
