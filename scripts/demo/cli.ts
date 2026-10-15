import {
  type AuditCaseRepository,
  createDb,
  createRepository,
  type DrizzleDB,
} from "../../apps/api/src/db/repositories";
import { runDemoWorldOperation } from "../../apps/api/src/demo/demo-world-operation";
import { readDemoWorld } from "../../apps/api/src/demo/seed-world";
import { loadManagedDemoEnvironment, redactDemoOutput } from "./managed-environment";

/**
 * The demo stack's command surface:
 *
 *   bun scripts/demo/cli.ts up      # managed env → compose → migrate → rebuild → verify
 *   bun scripts/demo/cli.ts down    # stop the demo compose project (volumes kept)
 *   bun scripts/demo/cli.ts reset   # atomic reset + rebuild of the demo world
 *   bun scripts/demo/cli.ts seed    # alias of reset: the world is rebuilt, not patched
 *   bun scripts/demo/cli.ts verify  # post-boot acceptance against the running API
 *   bun scripts/demo/cli.ts check   # diagnostics only
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

switch (command) {
  case "up": {
    // One command from a clean checkout: managed env, isolated compose stack,
    // migrations, a rebuilt demo world, and a health check. Each step's real
    // result is printed; a failure stops the sequence.
    const env = await loadManagedDemoEnvironment(true);
    const compose = Bun.spawnSync({
      cmd: [
        "docker",
        "compose",
        "--env-file",
        env.path,
        "--project-name",
        env.values.COMPOSE_PROJECT_NAME,
        "up",
        "-d",
        "--wait",
        "postgres",
        "rustfs",
        "redis",
        "rustfs-init",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (compose.exitCode !== 0) {
      fail(
        redactDemoOutput(
          "docker compose 启动失败；请确认 Docker 正在运行。\n" +
            new TextDecoder().decode(compose.stderr),
          env.values,
        ),
      );
    }
    console.log(
      `基础设施就绪（compose 项目 ${env.values.COMPOSE_PROJECT_NAME}，凭据已生成且不回显）`,
    );
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
    await withDatabase(env.values, async ({ repository }) => {
      const result = await runDemoWorldOperation(repository, {
        ...guardInput(env.values),
        seed: rebuildOptions(env.values),
      });
      if (!result.outcome.ok) refuse(result.outcome.code, result.outcome.reason);
      console.log(
        `演示世界已重建：移除 ${result.outcome.ok ? result.outcome.removed : 0}，播种 ${result.planted}，可见 ${result.view?.seededCaseCount ?? 0}`,
      );
    });
    // Health is checked against the API the operator starts (or the container
    // stack starts); `up` does not silently assume a server it did not start.
    const apiOrigin = env.apiOrigin;
    try {
      const health = await fetch(`${apiOrigin}/api/health`);
      console.log(`API 健康：${health.ok ? "正常" : `异常（${health.status}）`} @ ${apiOrigin}`);
    } catch {
      console.log(
        `API 未在 ${apiOrigin} 应答；按 docs/deployment/demo.md 启动 API 后运行 verify。`,
      );
    }
    console.log("下一步：bun scripts/demo/cli.ts verify");
    break;
  }

  case "down": {
    const env = await loadManagedDemoEnvironment(false);
    const compose = Bun.spawnSync({
      cmd: [
        "docker",
        "compose",
        "--env-file",
        env.path,
        "--project-name",
        env.values.COMPOSE_PROJECT_NAME,
        "down",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (compose.exitCode !== 0) fail("docker compose down 失败。");
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
        console.warn(
          `警告：孤儿检查未通过（影子任务 ${orphans.shadowJobs}、影子反馈 ${orphans.shadowFeedback}、核验来源 ${orphans.verificationSources}）；请人工检查。`,
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
    const token = env.values.API_ACCESS_TOKEN ?? "";
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
    const authedGet = async (path: string) => {
      const response = await fetch(`${base}${path}`, {
        headers: token === "" ? {} : { authorization: `Bearer ${token}` },
      });
      return { response, body: await response.text() };
    };

    console.log(`验证目标：${base}`);
    await check("健康检查返回 200", async () => {
      const response = await fetch(`${base}/api/health`);
      if (!response.ok) throw new Error(`status ${response.status}`);
    });
    await check("会话门禁报告认证状态", async () => {
      const response = await fetch(`${base}/api/session`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const parsed = (await response.json()) as {
        authenticationRequired: boolean;
        authenticated: boolean;
      };
      if (typeof parsed.authenticationRequired !== "boolean") {
        throw new Error("响应缺少 authenticationRequired");
      }
    });
    await check("演示世界可读", async () => {
      const { response } = await authedGet("/api/demo/world");
      if (!response.ok) throw new Error(`status ${response.status}`);
    });
    if (failures.length > 0) fail(`验证未通过：${failures.join("、")}`);
    console.log("验证通过。");
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

  default: {
    console.log(
      [
        "用法：bun scripts/demo/cli.ts <命令>",
        "",
        "  up      受管环境 + compose + 迁移 + 重建演示世界 + 健康检查",
        "  down    停止演示栈（保留数据卷）",
        "  reset   原子化重建演示世界（= seed）",
        "  seed    同 reset",
        "  verify  对运行中的 API 做启动验收",
        "  check   只诊断，不修改任何数据",
      ].join("\n"),
    );
    if (command !== "help") process.exit(2);
  }
}
