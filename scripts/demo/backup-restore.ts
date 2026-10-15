import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createDb } from "../../apps/api/src/db/repositories";
import {
  checkDemoResetIdentity,
  readDemoEnvironmentIdentity,
} from "../../apps/api/src/demo/demo-environment";
import {
  loadManagedDemoEnvironment,
  type ManagedDemoEnvironment,
  redactDemoOutput,
} from "./managed-environment";

/**
 * Backup and restore for the managed demo stack, built around one rule: a
 * restore writes into a database that does not exist yet.
 *
 * Nothing here overwrites. There is no `--clean`, no drop of the source, no
 * path that can point a restore at the live database. The source database and
 * the object store are left exactly as they were, which is what makes
 * "restore to a disposable copy" a safe rehearsal rather than a gamble with
 * the only copy of the data.
 *
 *   bun --env-file=.demo.env scripts/demo/backup-restore.ts backup
 *   RESTORE_DATABASE_NAME=contract_audit_restore \
 *     bun --env-file=.demo.env scripts/demo/backup-restore.ts restore
 *
 * Credentials never travel as command arguments or printed output. The client
 * tools are driven through libpq environment parameters (PGHOST/PGPORT/...),
 * so `ps` shows a passwordless command line and `pg_dump` never echoes its
 * connection string on failure. Anything a child prints passes through
 * `redactDemoOutput` before it reaches the terminal.
 *
 * Scope: this tool copies the database only. Object-storage bytes are not
 * backed up and not restored — originals are immutable once written and
 * shared by locator, so a restored copy's rows keep pointing at the same
 * bucket. Copying them would duplicate bytes without changing any answer;
 * deleting them is never something a restore may do. This is therefore not a
 * full disaster-recovery procedure, and the docs say so.
 */

const command = process.argv[2] ?? "help";

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const restoreName = process.env.RESTORE_DATABASE_NAME?.trim() ?? "";
const backupDir = resolve(process.env.DEMO_BACKUP_DIR?.trim() || ".demo/backups");

/** libpq environment parameters for one host:port/user/password/database. */
const connectionEnv = (
  values: Record<string, string>,
  databaseName: string,
): Record<string, string> => ({
  PGHOST: "127.0.0.1",
  PGPORT: values.POSTGRES_PORT,
  PGUSER: values.POSTGRES_USER,
  PGPASSWORD: values.POSTGRES_PASSWORD,
  PGDATABASE: databaseName,
});

/** libpq env for the bootstrap `postgres` database (CREATE DATABASE happens there). */
const adminConnectionEnv = (values: Record<string, string>): Record<string, string> =>
  connectionEnv(values, "postgres");

/**
 * Runs one child command, failing loudly on a non-zero exit. Output is
 * captured, redacted, and only then shown: a pg tool that prints its
 * connection settings on failure must not become a credential leak.
 */
const run = (cmd: string[], env: Record<string, string>, label: string): void => {
  const result = Bun.spawnSync({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const text =
    `${new TextDecoder().decode(result.stdout)}\n${new TextDecoder().decode(result.stderr)}`.trim();
  if (result.exitCode !== 0) {
    fail(
      redactDemoOutput(
        `${label}失败（退出码 ${result.exitCode}）。${text ? `\n${text}` : ""}`,
        env,
      ),
    );
  }
};

/**
 * One truth check per run, from the running server itself: which database
 * this connection lands on, and what the `demo_environments` registration
 * says the named environment owns. The reset guard's identity half is the
 * same check, so a database that cannot be reset cannot be copied either.
 */
const validateSourceIdentity = async (
  values: Record<string, string>,
  databaseName: string,
): Promise<void> => {
  const { db, client } = createDb(values.DATABASE_URL);
  try {
    const identity = await readDemoEnvironmentIdentity(db, values.DEMO_ENVIRONMENT_ID);
    const guard = checkDemoResetIdentity({
      environmentId: values.DEMO_ENVIRONMENT_ID,
      databaseName,
      identity,
    });
    if (!guard.ok) fail(`拒绝执行（${guard.refusal.code}）：${guard.refusal.reason}`);
  } finally {
    await client.end({ timeout: 5 });
  }
};

/**
 * The same environment guard the reset uses (APP_ENV + confirmation), then
 * the registered identity check against the live server.
 */
const requireDemoEnvironment = async (): Promise<{
  values: Record<string, string>;
  databaseName: string;
}> => {
  let env: ManagedDemoEnvironment | undefined;
  try {
    env = await loadManagedDemoEnvironment(false);
  } catch (error) {
    fail(
      `受管环境不可用（先执行 bun --env-file=.demo.env scripts/demo/cli.ts up 生成 .demo.env）：` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // `fail` exits, but TypeScript still sees `env` as possibly undefined here.
  if (env === undefined) {
    throw new Error("受管环境不可用。");
  }
  const values = env.values;
  const databaseName = values.DEMO_DATABASE_NAME;
  await validateSourceIdentity(values, databaseName);
  return { values, databaseName };
};

switch (command) {
  case "backup": {
    const { values, databaseName } = await requireDemoEnvironment();
    mkdirSync(backupDir, { recursive: true });
    // A timestamped file, so repeated backups never overwrite each other and a
    // rehearsal can be traced back to the exact dump it used.
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const target = resolve(backupDir, `${databaseName}-${stamp}.dump`);
    // Custom format keeps the restore selective; --no-owner/--no-privileges
    // keep a dump portable into a differently-named local role. The
    // connection travels as libpq environment parameters, not as a URL
    // argument that `ps` would show.
    run(
      ["pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--file", target],
      connectionEnv(values, databaseName),
      "备份",
    );
    console.log(`备份完成：${target}`);
    console.log("对象存储中的原件未复制也未删除；这不是完整灾备，见 docs/deployment/demo.md。");
    break;
  }

  case "restore": {
    if (restoreName === "") {
      fail("RESTORE_DATABASE_NAME 未设置；恢复必须写入一个全新的数据库名。");
    }
    const { values, databaseName } = await requireDemoEnvironment();
    if (restoreName === databaseName) {
      fail(
        `拒绝恢复：RESTORE_DATABASE_NAME 与源库同名（${databaseName}），这会覆盖唯一的数据副本。`,
      );
    }
    if (!/^[_a-zA-Z][_a-zA-Z0-9$]{0,62}$/u.test(restoreName)) {
      fail(`RESTORE_DATABASE_NAME 不是合法的 PostgreSQL 标识符：${restoreName}`);
    }

    // The newest dump in the backup directory; an explicit DUMP_FILE overrides.
    const explicit = process.env.DUMP_FILE?.trim();
    let dumpPath = explicit ? resolve(explicit) : "";
    if (!explicit) {
      const candidates = existsSync(backupDir)
        ? readdirSync(backupDir)
            .filter((name) => name.endsWith(".dump"))
            .sort()
            .reverse()
        : [];
      if (candidates.length === 0) fail(`${backupDir} 中没有 .dump 备份；先执行 backup。`);
      dumpPath = resolve(backupDir, candidates[0] as string);
    }
    if (!existsSync(dumpPath)) fail(`备份文件不存在：${dumpPath}`);

    // The target must not exist. Creating it is the only write this command
    // performs against the server, and an existing name is a refusal rather
    // than a prompt to drop it. The name travels as a bound parameter, so a
    // value with a quote in it is data, never SQL.
    const { client: adminClient } = createDb(values.DATABASE_URL);
    let alreadyExists = false;
    try {
      const rows = await adminClient.unsafe<{ found: number }[]>(
        "SELECT 1 AS found FROM pg_database WHERE datname = $1",
        [restoreName],
      );
      alreadyExists = rows.length > 0;
    } finally {
      await adminClient.end({ timeout: 5 });
    }
    if (alreadyExists) {
      fail(`拒绝恢复：数据库 ${restoreName} 已存在。恢复只写入不存在的库，请换一个一次性名称。`);
    }
    // createdb connects to the bootstrap `postgres` database via libpq env and
    // takes the new name as its only positional argument — no URL anywhere.
    run(["createdb", restoreName], adminConnectionEnv(values), "创建目标库");
    run(
      ["pg_restore", "--no-owner", "--no-privileges", dumpPath],
      connectionEnv(values, restoreName),
      "恢复",
    );

    console.log(`恢复完成：${restoreName}（来自 ${dumpPath}）`);
    console.log("源库与对象存储保持不变；这是一个一次性副本，用完后请手动 drop。");
    break;
  }

  default: {
    console.log(
      [
        "用法：bun --env-file=.demo.env scripts/demo/backup-restore.ts <命令>",
        "",
        "  backup   备份受管演示库到 .demo/backups/<库名>-<时间戳>.dump",
        "  restore  恢复到全新的数据库（RESTORE_DATABASE_NAME 必须不存在）",
        "",
        "环境变量：",
        "  RESTORE_DATABASE_NAME 恢复目标库名；必须与源库不同且尚不存在",
        "  DUMP_FILE             可选，指定备份文件；缺省取 .demo/backups 中最新的一个",
        "  DEMO_BACKUP_DIR       备份目录，缺省 .demo/backups",
        "",
        "连接与凭据来自受管 .demo.env；不读取根 .env，口令经 libpq 环境参数传递，",
        "不进入命令行参数或日志。",
      ].join("\n"),
    );
    if (command !== "help") process.exit(2);
  }
}
