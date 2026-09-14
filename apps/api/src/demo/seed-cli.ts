import { loadApiConfig } from "../config";
import { createDb, createRepository } from "../db/repositories";
import { seedDemoWorld } from "./seed-world";

if (import.meta.main) {
  const config = loadApiConfig();
  const { db, client } = createDb(config.databaseUrl);
  const repository = createRepository(db);
  const fillerCount = Number.parseInt(process.env.DEMO_FILLER_COUNT ?? "", 10);
  const result = await seedDemoWorld(repository, {
    reset: true,
    ...(Number.isFinite(fillerCount) ? { fillerCount } : {}),
  });
  console.log(
    `demo world ready: planted ${result.planted}, removed ${result.removed}, visible ${result.seededCaseCount}`,
  );
  await client.end({ timeout: 5 });
}
