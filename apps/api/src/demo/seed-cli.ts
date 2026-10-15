import { loadApiConfig } from "../config";
import { createDb, createRepository } from "../db/repositories";
import { runDemoWorldOperation } from "./demo-world-operation";

if (import.meta.main) {
  // The CLI seeds through the same atomic operation as the HTTP route: one
  // transaction holds the advisory lock, the identity check, the delete and the
  // seed. Refusals are answers, not errors to work around.
  const config = loadApiConfig();
  const { db, client } = createDb(config.databaseUrl);
  const repository = createRepository(db);
  const fillerCount = Number.parseInt(process.env.DEMO_FILLER_COUNT ?? "", 10);
  const result = await runDemoWorldOperation(repository, {
    appEnv: process.env.APP_ENV,
    confirmation: process.env.DEMO_RESET_CONFIRMATION,
    environmentId: process.env.DEMO_ENVIRONMENT_ID,
    databaseName: process.env.DEMO_DATABASE_NAME,
    databaseUrl: config.databaseUrl,
    seed: {
      ...(Number.isFinite(fillerCount) ? { fillerCount } : {}),
    },
  });
  if (!result.outcome.ok) {
    console.error(`拒绝执行（${result.outcome.code}）：${result.outcome.reason}`);
    await client.end({ timeout: 5 });
    process.exit(1);
  }
  console.log(
    `demo world ready: planted ${result.planted}, removed ${result.outcome.removed}, visible ${result.view?.seededCaseCount ?? 0}`,
  );
  await client.end({ timeout: 5 });
}
