import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createDb } from "../../apps/api/src/db/repositories";
import { checkDemoResetEnvironment } from "../../apps/api/src/demo/demo-environment";

/**
 * Backup and restore for the demo stack, built around one rule: a restore
 * writes into a database that does not exist yet.
 *
 * Nothing here overwrites. There is no `--clean`, no drop of the source, no
 * path that can point a restore at the live database. The source database and
 * every object in the object store are left exactly as they were, which is
 * what makes "restore to a disposable copy" a safe rehearsal for a migration
 * or a reset rather than a gamble with the only copy of the data.
 *
 *   bun --env-file=.env scripts/demo/backup-restore.ts backup
 *   bun --env-file=.env scripts/demo/backup-restore.ts restore
 *
 * Object-storage bytes are deliberately out of scope: originals are immutable
 * once written and shared by locator, so a restored database's rows keep
 * pointing at the same bucket. Copying them would duplicate bytes without
 * changing any answer; deleting them is never something a restore may do.
 */

const command = process.argv[2] ?? "help";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseName = process.env.DEMO_DATABASE_NAME ?? "";
const restoreName = process.env.RESTORE_DATABASE_NAME ?? "";
const backupDir = resolve(process.env.DEMO_BACKUP_DIR ?? ".demo/backups");

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

/** The database name a connection string addresses, without parsing the URL by hand. */
const databaseNameOf = async (url: string): Promise<string> => {
  const { client } = createDb(url);
  try {
    // `current_database()` is the server's own answer; a URL's path segment is
    // only what the client intended.
    const rows = await client.unsafe<{ current_database: string }[]>(
      "SELECT current_database() AS current_database",
    );
    return rows[0]?.current_database ?? "";
  } finally {
    await client.end({ timeout: 5 });
  }
};

/**
 * The same environment guard the reset uses. A backup reads a whole database
 * and a restore creates one, so both are gated by `APP_ENV` and the registered
 * identity — an operator who cannot reset this database cannot copy it either.
 */
const requireDemoEnvironment = (): void => {
  const guard = checkDemoResetEnvironment({
    appEnv: process.env.APP_ENV,
    confirmation: databaseName,
    environmentId: process.env.DEMO_ENVIRONMENT_ID,
    databaseName,
    databaseUrl,
  });
  if (!guard.ok) fail(`拒绝执行（${guard.refusal.code}）：${guard.refusal.reason}`);
};

/** Runs one command, streaming its output, and fails loudly on a non-zero exit. */
const run = (cmd: string[], options: { env?: Record<string, string> } = {}): void => {
  const result = Bun.spawnSync({
    cmd,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...options.env },
  });
  if (result.exitCode !== 0) fail(`命令失败：${cmd.join(" ")}`);
};

const connectionEnv = (url: string): Record<string, string> => ({ DATABASE_URL: url });

switch (command) {
  case "backup": {
    requireDemoEnvironment();
    const actual = await databaseNameOf(databaseUrl);
    if (actual !== databaseName) {
      fail(`拒绝备份：当前连接的是 ${actual}，而 DEMO_DATABASE_NAME 指向 ${databaseName}。`);
    }
    mkdirSync(backupDir, { recursive: true });
    // A timestamped file, so repeated backups never overwrite each other and a
    // rehearsal can be traced back to the exact dump it used.
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const target = resolve(backupDir, `${databaseName}-${stamp}.dump`);
    // Custom format keeps the restore selective; --no-owner/--no-privileges
    // keep a dump portable into a differently-named local role.
    run(
      [
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        databaseUrl,
        "--file",
        target,
      ],
      { env: connectionEnv(databaseUrl) },
    );
    console.log(`备份完成：${target}`);
    console.log("对象存储中的原件未复制也未删除：恢复后的行仍指向同一个桶。");
    break;
  }

  case "restore": {
    requireDemoEnvironment();
    if (restoreName === "") {
      fail("RESTORE_DATABASE_NAME 未设置；恢复必须写入一个全新的数据库名。");
    }
    if (restoreName === databaseName) {
      fail(
        `拒绝恢复：RESTORE_DATABASE_NAME 与源库同名（${databaseName}），这会覆盖唯一的数据副本。`,
      );
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
    const adminUrl = new URL(databaseUrl);
    adminUrl.pathname = "/postgres";
    const { client: adminClient } = createDb(adminUrl.toString());
    let alreadyExists = false;
    try {
      // `unsafe` with a parameter array is postgres-js's parameterized escape
      // hatch; the name travels as data, never as SQL text.
      const rows = await adminClient.unsafe<{ found: number }[]>(
        "SELECT 1 AS found FROM pg_database WHERE datname = $1",
        [restoreName],
      );
      alreadyExists = rows.length > 0;
    } catch (error) {
      fail(
        `无法查询目标数据库是否已存在：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await adminClient.end({ timeout: 5 });
    }
    if (alreadyExists) {
      fail(`拒绝恢复：数据库 ${restoreName} 已存在。恢复只写入不存在的库，请换一个一次性名称。`);
    }
    run(["createdb", "--dbname", adminUrl.toString(), restoreName], {
      env: connectionEnv(adminUrl.toString()),
    });

    const targetUrl = new URL(databaseUrl);
    targetUrl.pathname = `/${restoreName}`;
    run(
      ["pg_restore", "--no-owner", "--no-privileges", "--dbname", targetUrl.toString(), dumpPath],
      {
        env: connectionEnv(targetUrl.toString()),
      },
    );
    console.log(`恢复完成：${restoreName}（来自 ${dumpPath}）`);
    console.log(`连接：${targetUrl.toString()}`);
    console.log("源库与对象存储保持不变；这是一个一次性副本，用完后请手动 drop。");
    break;
  }

  default: {
    console.log(
      [
        "用法：bun --env-file=.env scripts/demo/backup-restore.ts <命令>",
        "",
        "  backup   备份当前演示库到 .demo/backups/<库名>-<时间戳>.dump",
        "  restore  恢复到全新的数据库（RESTORE_DATABASE_NAME 必须不存在）",
        "",
        "环境变量：",
        "  DATABASE_URL          源库连接（备份读取它）",
        "  DEMO_DATABASE_NAME    源库名，用于身份校验",
        "  DEMO_ENVIRONMENT_ID   已注册的演示环境",
        "  RESTORE_DATABASE_NAME 恢复目标库名；必须与源库不同且尚不存在",
        "  DUMP_FILE             可选，指定备份文件；缺省取 .demo/backups 中最新的一个",
        "  DEMO_BACKUP_DIR       备份目录，缺省 .demo/backups",
      ].join("\n"),
    );
    if (command !== "help") process.exit(2);
  }
}
