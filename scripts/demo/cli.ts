import { randomUUID } from "node:crypto";
import { createAuditSnapshot } from "@contract-audit/audit/orchestrator";
import { normalizeContractDocument } from "@contract-audit/audit/plaintext-adapter";
import {
  type AuditCaseRepository,
  createDb,
  createRepository,
  type DrizzleDB,
} from "../../apps/api/src/db/repositories";
import {
  checkDemoResetIdentity,
  readDemoEnvironmentIdentity,
} from "../../apps/api/src/demo/demo-environment";
import { runDemoWorldOperation } from "../../apps/api/src/demo/demo-world-operation";
import { readDemoWorld } from "../../apps/api/src/demo/seed-world";
import {
  loadManagedDemoEnvironment,
  type ManagedDemoEnvironment,
  projectRoot,
  redactDemoOutput,
} from "./managed-environment";

/**
 * The demo stack's command surface:
 *
 *   bun scripts/demo/cli.ts up      # managed env → infra → migrate → register → (init) → api/web → checks
 *   bun scripts/demo/cli.ts down    # stop the demo compose project (volumes kept)
 *   bun scripts/demo/cli.ts reset   # atomic reset + rebuild of the demo world
 *   bun scripts/demo/cli.ts seed    # alias of reset: the world is rebuilt, not patched
 *   bun scripts/demo/cli.ts verify  # post-boot acceptance against the running API
 *   bun scripts/demo/cli.ts check   # diagnostics only
 *   bun scripts/demo/cli.ts logs    # compose logs for one or all services
 *   bun scripts/demo/cli.ts status  # compose ps for the demo project
 *   bun scripts/demo/cli.ts ready   # up + two resets compared + sentinel preserved
 *
 * Every destructive command runs through `runDemoWorldOperation`, the same
 * transaction the HTTP route uses: environment guard, database identity and
 * registration, active-run refusal, the exclusive advisory lock, the delete and
 * the seed. There is no unguarded path to fall back to.
 *
 * The stack runs under a managed environment file (`.demo.env`, generated 0600
 * on first use, random credentials, isolated compose project and host ports):
 * the developer's root `.env` is never read or written. Output is passed
 * through `redactDemoOutput`, so a credential never lands in a terminal or a
 * log even when a child command prints its environment.
 */

const command = process.argv[2] ?? "help";

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const refuse = (code: string, reason: string): never => {
  console.error(`拒绝执行（${code}）：${reason}`);
  process.exit(1);
};

const integerEnv = (values: Record<string, string>, name: string): number | undefined => {
  const raw = values[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const withDatabase = async <T>(
  values: Record<string, string>,
  body: (input: { repository: AuditCaseRepository; db: DrizzleDB }) => Promise<T>,
): Promise<T> => {
  const { db, client } = createDb(values.DATABASE_URL);
  try {
    return await body({ repository: createRepository(db), db });
  } finally {
    await client.end({ timeout: 5 });
  }
};

const guardInput = (values: Record<string, string>) => ({
  appEnv: values.APP_ENV,
  confirmation: values.DEMO_RESET_CONFIRMATION,
  environmentId: values.DEMO_ENVIRONMENT_ID,
  databaseName: values.DEMO_DATABASE_NAME,
  databaseUrl: values.DATABASE_URL,
});

const rebuildOptions = (values: Record<string, string>) => {
  const fillerCount = integerEnv(values, "DEMO_FILLER_COUNT");
  const rngSeed = integerEnv(values, "DEMO_RNG_SEED");
  return {
    ...(fillerCount === undefined ? {} : { fillerCount }),
    ...(rngSeed === undefined ? {} : { rngSeed }),
  };
};

/**
 * One compose child against the managed env file. The child receives the
 * merged process environment plus the managed values, so an operator's shell
 * `.env` can only fill compose's `${VAR:-default}` interpolations through the
 * values we pass — `--env-file` stays authoritative for the stack itself.
 */
const composeSync = (
  args: string[],
  env: ManagedDemoEnvironment,
): { exitCode: number | null; stdout: string; stderr: string } => {
  const result = Bun.spawnSync({
    cmd: [...env.compose, ...args],
    cwd: projectRoot,
    env: { ...process.env, ...env.values },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
};

const runCompose = (args: string[], env: ManagedDemoEnvironment, label: string): string => {
  const result = composeSync(args, env);
  if (result.exitCode !== 0) {
    fail(
      redactDemoOutput(
        `${label}失败（退出码 ${result.exitCode}）。${result.stderr.trim()}`,
        env.values,
      ),
    );
  }
  return result.stdout;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const checkLiveStack = async (env: ManagedDemoEnvironment): Promise<string[]> => {
  const failures: string[] = [];
  try {
    const response = await fetch(`${env.apiOrigin}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      failures.push(`/api/health 返回 ${response.status}`);
    } else {
      const health: unknown = await response.json();
      if (!isRecord(health) || !isRecord(health.connections)) {
        failures.push("API 健康响应缺少组件状态");
      } else {
        for (const name of ["database", "redis", "objectStore", "dispatcher"]) {
          const connection = health.connections[name];
          if (!isRecord(connection) || connection.ok !== true) {
            failures.push(`必需组件 ${name} 未就绪`);
          }
        }
      }
    }
  } catch {
    failures.push("API 健康检查无有效应答");
  }
  try {
    const response = await fetch(env.webOrigin, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
      failures.push(`Web 未返回有效页面（${response.status}）`);
    }
  } catch {
    failures.push("Web 无应答");
  }
  return failures;
};

/** Removes only this invocation's temporary sentinel, never pre-existing data. */
const removeReadySentinel = async (
  values: Record<string, string>,
  sourceId: string,
): Promise<void> => {
  const { client } = createDb(values.DATABASE_URL);
  try {
    await client.begin(async (tx) => {
      const rows = await tx<
        {
          case_id: string;
          status: string;
          contract_id: string | null;
        }[]
      >`
        SELECT c.id AS case_id, c.status, r.contract_id
        FROM source_records s
        JOIN audit_cases c ON c.source_record_id = s.id
        JOIN contract_revisions r ON r.id = c.contract_revision_id
        WHERE s.id = ${sourceId} AND s.metadata->>'readySentinelRun' = ${sourceId}
        FOR UPDATE OF s, c
      `;
      if (rows.length === 0) return;
      if (rows.length !== 1 || rows[0].status !== "INTERRUPTED") {
        throw new Error("READINESS_SENTINEL_CHANGED: 保留已发生变化的哨兵记录");
      }
      const row = rows[0];
      await tx`DELETE FROM audit_snapshots WHERE audit_case_id = ${row.case_id}`;
      await tx`DELETE FROM audit_cases WHERE id = ${row.case_id}`;
      await tx`DELETE FROM contract_revisions WHERE source_record_id = ${sourceId}`;
      if (row.contract_id !== null) {
        await tx`DELETE FROM contracts WHERE id = ${row.contract_id}
          AND NOT EXISTS (SELECT 1 FROM contract_revisions WHERE contract_id = ${row.contract_id})`;
      }
      await tx`DELETE FROM source_records
        WHERE id = ${sourceId} AND metadata->>'readySentinelRun' = ${sourceId}`;
    });
  } finally {
    await client.end({ timeout: 5 });
  }
};

switch (command) {
  case "up": {
    // One command from a clean checkout: managed env, infra containers,
    // bucket init, migrations, demo registration, an initial rebuild only
    // when the world is empty, then the api/web containers built from the
    // current source. Each step's real result is printed; a failure stops
    // the sequence and later steps never run.
    const env = await loadManagedDemoEnvironment(true);

    // Stage 1: long-running infra. `--wait` is not applied to the one-shot
    // rustfs-init: a service with no restart policy exits and would fail
    // `--wait`; it runs explicitly in stage 2 instead.
    runCompose(["up", "-d", "--wait", "postgres", "rustfs", "redis"], env, "基础设施启动");
    console.log(
      `基础设施就绪（compose 项目 ${env.values.COMPOSE_PROJECT_NAME}，凭据已生成且不回显）`,
    );

    // Stage 2: one-shot bucket init, then wait for its completion.
    runCompose(["run", "--rm", "rustfs-init"], env, "对象存储桶初始化");
    console.log("对象存储桶就绪");

    // Stage 3: migrations against the managed database only. An explicit
    // DATABASE_URL means drizzle.config never falls back to a root .env.
    const migrate = Bun.spawnSync({
      cmd: ["bun", "run", "--filter", "@contract-audit/api", "migrate"],
      env: { ...process.env, DATABASE_URL: env.values.DATABASE_URL },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (migrate.exitCode !== 0) {
      fail(
        redactDemoOutput(
          `迁移失败；数据库未达到目标 schema。\n${new TextDecoder().decode(migrate.stderr)}`,
          env.values,
        ),
      );
    }
    console.log("迁移完成");

    // Stage 4: register the demo identity after the server itself confirms
    // which database this connection lands on, then rebuild the world only
    // when there is nothing seeded yet. A repeated `up` keeps live demo data;
    // an explicit reset is the only other path to a rebuild.
    await withDatabase(env.values, async ({ repository }) => {
      const world = await readDemoWorld(repository);
      if (world.seededCaseCount === 0) {
        await repository.registerDemoEnvironment({
          environmentId: env.values.DEMO_ENVIRONMENT_ID,
          databaseName: env.values.DEMO_DATABASE_NAME,
        });
        const result = await runDemoWorldOperation(repository, {
          ...guardInput(env.values),
          seed: rebuildOptions(env.values),
        });
        if (!result.outcome.ok) refuse(result.outcome.code, result.outcome.reason);
        console.log(
          `演示世界已初始化：移除 ${result.outcome.ok ? result.outcome.removed : 0}，播种 ${result.planted}，可见 ${result.view?.seededCaseCount ?? 0}`,
        );
      } else {
        console.log(
          `检测到已有演示世界（${world.seededCaseCount} 个案件）；跳过重建，需要时执行 reset。`,
        );
      }
    });

    // Stage 5: application containers, built from the current source and
    // waited to health, on the managed isolated ports.
    runCompose(["up", "-d", "--build", "--wait", "api", "web"], env, "应用容器启动");

    // Stage 6: real checks against what actually came up — no success claim
    // without an answer.
    const failures = await checkLiveStack(env);
    if (failures.length > 0) fail(`启动未通过验证：${failures.join("；")}`);
    console.log(`API 健康：${env.apiOrigin}`);
    console.log(`Web 就绪：${env.webOrigin}`);
    console.log("下一步：bun --env-file=.demo.env scripts/demo/cli.ts verify");
    break;
  }

  case "down": {
    const env = await loadManagedDemoEnvironment(false);
    runCompose(["down"], env, "docker compose down");
    console.log("演示栈已停止（数据卷保留）。");
    break;
  }

  case "reset":
  case "seed": {
    // Both words mean the same thing: the world is rebuilt atomically. A
    // reset-only mode would leave the stack with no demo data, which is never
    // what a demo operator wants.
    const env = await loadManagedDemoEnvironment(false);
    await withDatabase(env.values, async ({ repository }) => {
      const result = await runDemoWorldOperation(repository, {
        ...guardInput(env.values),
        seed: rebuildOptions(env.values),
      });
      if (!result.outcome.ok) refuse(result.outcome.code, result.outcome.reason);
      console.log(
        `演示世界已重建：移除 ${result.outcome.ok ? result.outcome.removed : 0}，播种 ${result.planted}，可见 ${result.view?.seededCaseCount ?? 0}`,
      );
      const orphans = await repository.countDemoResetOrphans();
      if (orphans.shadowJobs > 0 || orphans.shadowFeedback > 0 || orphans.verificationSources > 0) {
        fail(
          `孤儿检查未通过（影子任务 ${orphans.shadowJobs}、影子反馈 ${orphans.shadowFeedback}、核验来源 ${orphans.verificationSources}）`,
        );
      } else {
        console.log("孤儿校验通过：无未归属的影子记录与核验来源。");
      }
    });
    break;
  }

  case "verify": {
    const env = await loadManagedDemoEnvironment(false);
    const base = env.apiOrigin;
    const failures: string[] = [];
    const check = async (name: string, body: () => Promise<void>) => {
      try {
        await body();
        console.log(`  ✓ ${name}`);
      } catch (error) {
        failures.push(name);
        console.error(`  ✗ ${name}：${error instanceof Error ? error.message : String(error)}`);
      }
    };

    console.log(`验证目标：${base}`);
    await check("必需组件与 Web 真实就绪", async () => {
      const issues = await checkLiveStack(env);
      if (issues.length > 0) throw new Error(issues.join("；"));
    });
    await check("无需登录即可读取审计队列", async () => {
      const response = await fetch(`${base}/api/audit-cases`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      if (!Array.isArray(await response.json())) throw new Error("审计队列响应不是案件列表");
    });
    await check("演示世界可读", async () => {
      const response = await fetch(`${base}/api/demo/world`);
      if (!response.ok) throw new Error(`status ${response.status}`);
    });
    if (failures.length > 0) fail(`验证未通过：${failures.join("、")}`);
    console.log("验证通过。");
    break;
  }

  case "logs": {
    const env = await loadManagedDemoEnvironment(false);
    const text = runCompose(["logs", ...process.argv.slice(3)], env, "读取演示日志");
    console.log(redactDemoOutput(text, env.values));
    break;
  }

  case "status": {
    const env = await loadManagedDemoEnvironment(false);
    console.log(redactDemoOutput(runCompose(["ps"], env, "读取演示状态"), env.values));
    break;
  }

  case "check": {
    const env = await loadManagedDemoEnvironment(false);
    console.log(`受管环境：${env.path}`);
    console.log(
      `APP_ENV=${env.values.APP_ENV} DEMO_ENVIRONMENT_ID=${env.values.DEMO_ENVIRONMENT_ID}`,
    );
    console.log(
      `对象存储：${env.values.S3_ENDPOINT}（严格模式 ${env.values.S3_STRICT ?? "true"}）`,
    );
    console.log(`compose 项目：${env.values.COMPOSE_PROJECT_NAME}`);
    console.log("凭据值不回显。");
    await withDatabase(env.values, async ({ repository }) => {
      const world = await readDemoWorld(repository);
      console.log(
        `演示世界：案件 ${world.seededCaseCount}，填充 ${world.fillerCount}，种子 ${world.rngSeed ?? "未播种"}`,
      );
    });
    break;
  }

  case "ready": {
    // Readiness rehearsal: bring the stack up, plant a non-demo sentinel that
    // a reset must preserve, run two resets, and compare the worlds they
    // produce. The API is only "ready" when the second reset's world matches
    // the first (same cases, same keys), the sentinel survives both, and the
    // orphan checks report zero — otherwise this command fails loudly.
    const env = await loadManagedDemoEnvironment(true);

    console.log("启动并验证受管演示栈…");
    const boot = Bun.spawnSync({
      cmd: ["bun", import.meta.path, "up"],
      cwd: projectRoot,
      env: { ...process.env, ...env.values, DEMO_ENV_FILE: env.path },
      stdout: "pipe",
      stderr: "pipe",
    });
    const bootOutput = redactDemoOutput(
      `${new TextDecoder().decode(boot.stdout)}\n${new TextDecoder().decode(boot.stderr)}`,
      env.values,
    );
    if (boot.exitCode !== 0) fail(`演示栈启动失败：${bootOutput}`);
    console.log(bootOutput.trim());

    const sentinelId = randomUUID();
    let readinessFailure: string | undefined;
    let readyCaseCount = 0;
    try {
      await withDatabase(env.values, async ({ db }) => {
        const identity = await readDemoEnvironmentIdentity(db, env.values.DEMO_ENVIRONMENT_ID);
        const guard = checkDemoResetIdentity({
          environmentId: env.values.DEMO_ENVIRONMENT_ID,
          databaseName: env.values.DEMO_DATABASE_NAME,
          identity,
        });
        if (!guard.ok) throw new Error(`${guard.refusal.code}: ${guard.refusal.reason}`);
        await db.transaction(async (tx) => {
          // Drizzle transactions expose the repository's database operations.
          const sentinelRepository = createRepository(tx as unknown as DrizzleDB);
          const { caseId } = await sentinelRepository.createPendingCase(
            sentinelId,
            createAuditSnapshot({
              sourceRecordId: sentinelId,
              document: normalizeContractDocument("这是完全合成的非演示哨兵合同。"),
              policyLimitRatio: 0.3,
            }),
            { type: "TEXT_PASTE", displayName: "就绪校验临时哨兵" },
            { metadata: { readySentinelRun: sentinelId } },
          );
          await sentinelRepository.updateCaseStatus(caseId, "INTERRUPTED", "NORMALIZING");
        });
      });

      const observe = async (): Promise<{
        caseCount: number;
        keys: string[];
        sentinelAlive: boolean;
      }> =>
        withDatabase(env.values, async ({ repository }) => {
          const world = await readDemoWorld(repository);
          const sentinel = await repository.getSourceRecord(sentinelId);
          return {
            caseCount: world.seededCaseCount,
            keys: world.scenarios.flatMap((s) => s.cases.map((c) => c.caseKey)),
            sentinelAlive: sentinel !== null && sentinel !== undefined,
          };
        });

      // Reset 1, then observe.
      await withDatabase(env.values, async ({ repository }) => {
        const result = await runDemoWorldOperation(repository, {
          ...guardInput(env.values),
          seed: rebuildOptions(env.values),
        });
        if (!result.outcome.ok) throw new Error(`${result.outcome.code}: ${result.outcome.reason}`);
      });
      const first = await observe();

      // Reset 2, then observe again: two deterministic rebuilds must agree.
      await withDatabase(env.values, async ({ repository }) => {
        const result = await runDemoWorldOperation(repository, {
          ...guardInput(env.values),
          seed: rebuildOptions(env.values),
        });
        if (!result.outcome.ok) throw new Error(`${result.outcome.code}: ${result.outcome.reason}`);
      });
      const second = await observe();

      const failures: string[] = [];
      if (first.caseCount !== second.caseCount) {
        failures.push(`两次 reset 案件数不同（${first.caseCount} / ${second.caseCount}）`);
      }
      if (first.keys.join(",") !== second.keys.join(",")) {
        failures.push("两次 reset 的 caseKey 序列不同");
      }
      if (!first.sentinelAlive || !second.sentinelAlive) {
        failures.push("非演示哨兵案件在 reset 中丢失");
      }
      await withDatabase(env.values, async ({ repository }) => {
        const orphans = await repository.countDemoResetOrphans();
        if (
          orphans.shadowJobs > 0 ||
          orphans.shadowFeedback > 0 ||
          orphans.verificationSources > 0
        ) {
          failures.push(
            `孤儿校验未通过（影子任务 ${orphans.shadowJobs}、影子反馈 ${orphans.shadowFeedback}、核验来源 ${orphans.verificationSources}）`,
          );
        }
      });

      failures.push(...(await checkLiveStack(env)));
      if (failures.length > 0) throw new Error(failures.join("；"));
      readyCaseCount = second.caseCount;
    } catch (error) {
      readinessFailure = redactDemoOutput(
        error instanceof Error ? error.message : "就绪检查失败",
        env.values,
      );
    } finally {
      try {
        await removeReadySentinel(env.values, sentinelId);
      } catch (error) {
        const reason = redactDemoOutput(
          error instanceof Error ? error.message : "临时哨兵清理失败",
          env.values,
        );
        readinessFailure = [readinessFailure, reason].filter(Boolean).join("；");
      }
    }
    if (readinessFailure) fail(`就绪检查未通过：${readinessFailure}`);
    console.log(
      `就绪检查通过：两次 reset 一致（案件 ${readyCaseCount}），非演示哨兵保留验证通过且临时记录已清理，孤儿为 0，必需组件与 Web 就绪。`,
    );
    break;
  }

  default: {
    console.log(
      [
        "用法：bun scripts/demo/cli.ts <命令>",
        "",
        "  up      受管环境 + 基础设施 + 迁移 + 登记 + 首次播种 + api/web + 健康检查",
        "  down    停止演示栈（保留数据卷）",
        "  reset   原子化重建演示世界（= seed）",
        "  seed    同 reset",
        "  verify  对运行中的 API 做启动验收",
        "  check   只诊断，不修改任何数据",
        "  logs    compose 日志（可跟服务名，如 logs api）",
        "  status  compose ps",
        "  ready   up + 两次 reset 对比 + 非演示哨兵保护检查",
      ].join("\n"),
    );
    if (command !== "help") process.exit(2);
  }
}
