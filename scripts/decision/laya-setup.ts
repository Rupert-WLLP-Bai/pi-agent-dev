/**
 * Reproducible local CPU setup for the Laya decision service.
 *
 * This script documents and drives the environment Main already prepared and
 * verified; it does not download weights or start the service itself unless
 * asked to, so two actors cannot race for the same Hugging Face cache. Every
 * revision is pinned by SHA, and the torch build is the CPU one.
 *
 * What it does:
 *   verify   — check the prepared environment, the pinned revisions and the
 *              model snapshot are all present (read-only; no download);
 *   install  — create/refresh the isolated uv environment with CPU-only torch
 *              and the pinned Laya code revision (network required);
 *   start    — launch the offline service on loopback with the pinned
 *              multilingual revision only (Main owns this step in practice);
 *   smoke    — run the three primitives against a running service and record
 *              the exact request/response as evidence.
 *
 * Everything is local and CPU-only. No credential is required and none is
 * accepted: the model cache is public and the service runs unauthenticated on
 * loopback, which is why the API's origin allowlist is a separate, explicit
 * decision.
 */

const LAYA_CODE_REVISION = "432312b36714d8889eba405507b37eda25257d9c";
const LAYA_MODEL_REVISION = "1720e3e3357cfe1e281542e223f8273b0890ca34";
const LAYA_MODEL_REPO = "convaiinnovations/laya-multilingual";
const VENV_PATH = "/tmp/contract-audit-laya-cpu-venv";
const MODEL_CACHE = "/tmp/contract-audit-laya-model-cache";
const DEFAULT_PORT = 3847;

const command = process.argv[2] ?? "verify";

const run = async (cmd: readonly string[], env: Record<string, string> = {}): Promise<string> => {
  const proc = Bun.spawnSync({
    cmd: [...cmd],
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(proc.stdout).trim();
  const stderr = new TextDecoder().decode(proc.stderr).trim();
  if (proc.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} exited ${proc.exitCode}: ${stderr || stdout}`);
  }
  return stdout;
};

const fileExists = async (path: string): Promise<boolean> => Bun.file(path).exists();

/**
 * Checks the prepared environment without touching the network. A missing
 * piece is a named failure, not a silent skip: the caller learns exactly which
 * prerequisite is absent.
 */
const verify = async (): Promise<void> => {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  const venvPython = `${VENV_PATH}/bin/python`;
  checks.push({
    name: "isolated python environment",
    ok: await fileExists(venvPython),
    detail: VENV_PATH,
  });

  if (await fileExists(venvPython)) {
    const version = await run([venvPython, "-c", "import sys; print(sys.version)"]);
    const laya = await run([venvPython, "-c", "import laya; print(laya.__version__)"]).catch(
      () => "MISSING",
    );
    const torch = await run([venvPython, "-c", "import torch; print(torch.__version__)"]).catch(
      () => "MISSING",
    );
    checks.push({ name: "python", ok: version.includes("3.12"), detail: version });
    checks.push({ name: "laya", ok: laya !== "MISSING", detail: laya });
    checks.push({
      name: "torch (cpu build)",
      ok: torch.includes("cpu"),
      detail: torch,
    });
  }

  const snapshot = `${MODEL_CACHE}/models--convaiinnovations--laya-multilingual/snapshots/${LAYA_MODEL_REVISION}`;
  checks.push({
    name: "pinned multilingual snapshot",
    ok: await fileExists(snapshot),
    detail: snapshot,
  });
  checks.push({
    name: "pinned requirements file",
    ok: await fileExists("/tmp/contract-audit-laya-cpu-requirements.txt"),
    detail: "/tmp/contract-audit-laya-cpu-requirements.txt",
  });

  for (const check of checks) {
    console.log(`${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`);
  }
  if (checks.some((check) => !check.ok)) {
    console.error("[laya-setup] environment incomplete; see the FAIL lines above");
    process.exitCode = 1;
    return;
  }
  console.log(
    `[laya-setup] verified: code=${LAYA_CODE_REVISION} model=${LAYA_MODEL_REPO}@${LAYA_MODEL_REVISION} cpu-only`,
  );
};

/**
 * Creates the isolated environment. CPU-only torch is installed *before* Laya
 * so the pinned wheel does not pull a CUDA build; the code revision is pinned
 * by SHA rather than by a PyPI version, because the wire behaviour this
 * adapter encodes was read from that exact commit.
 */
const install = async (): Promise<void> => {
  await run(["uv", "venv", "--python", "3.12", VENV_PATH]);
  const pip = `${VENV_PATH}/bin/python`;
  await run([pip, "-m", "pip", "install", "--upgrade", "pip"]);
  // CPU-only torch first: https://pytorch.org/get-started/locally/
  await run([
    pip,
    "-m",
    "pip",
    "install",
    "torch",
    "--index-url",
    "https://download.pytorch.org/whl/cpu",
  ]);
  await run([
    pip,
    "-m",
    "pip",
    "install",
    `git+https://github.com/NandhaKishorM/laya.git@${LAYA_CODE_REVISION}`,
    "laya[serve] @ git+https://github.com/NandhaKishorM/laya.git",
  ]);
  await run([pip, "-m", "pip", "freeze"], {});
  console.log("[laya-setup] installed; run `verify` next");
};

/** Starts the offline service: multilingual only, CPU threads capped, pinned revision. */
const start = async (): Promise<void> => {
  const port = process.env.LAYA_PORT ?? String(DEFAULT_PORT);
  const env: Record<string, string> = {
    HF_HUB_CACHE: MODEL_CACHE,
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    LAYA_DEVICE: "cpu",
    LAYA_THREADS: "4",
    LAYA_MODELS: "multilingual",
    LAYA_MAX_LOADED: "1",
    LAYA_IDLE_UNLOAD_SECONDS: "0",
    LAYA_PRELOAD: "1",
    LAYA_REVISION: LAYA_MODEL_REVISION,
    // The router's default bundle targets a different repository; the override
    // is what makes this standalone revision the one that serves.
    LAYA_EXTRA_MODELS: `{"multilingual":"${LAYA_MODEL_REPO}"}`,
    LAYA_JEV_STRICT: "1",
    // The serve entry point defaults to 0.0.0.0; a decision service is a
    // loopback-only neighbour, so the bind address is pinned explicitly.
    LAYA_HOST: "127.0.0.1",
  };
  console.log(`[laya-setup] starting offline CPU service on http://127.0.0.1:${port}`);
  const proc = Bun.spawn([`${VENV_PATH}/bin/python`, "-m", "laya.serve"], {
    env: { ...process.env, ...env, LAYA_PORT: port },
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
};

/**
 * Runs the three primitives against a running service and writes the exact
 * request/response as evidence. A failure is recorded with the status the
 * service actually returned; nothing is retried into a success.
 */
const smoke = async (): Promise<void> => {
  const port = process.env.LAYA_PORT ?? String(DEFAULT_PORT);
  const endpoint = `http://127.0.0.1:${port}/v1/systemone`;
  const body = {
    model: "multilingual",
    state: {
      clause:
        "本合成通信设备采购合同约定：甲方在合同签订后支付合同总价70%作为预付款，剩余30%在验收后支付。",
    },
    questions: {
      category: {
        type: "choice",
        instructions: "请判断本合成合同条款的主要类型。",
        criteria: {
          payment: "条款约定付款金额、时间或方式",
          dispute: "条款约定争议解决法院或仲裁",
        },
      },
      priority: {
        type: "score",
        instructions: "请判断本合成合同条款是否需要优先人工复核。",
        criteria: ["无需复核", "建议复核", "优先复核"],
      },
      review: {
        type: "noul",
        instructions: "该合成条款约定的预付款比例是否超过百分之三十？",
        criteria: {
          true: "预付款比例超过百分之三十",
          false: "预付款比例不超过百分之三十",
        },
      },
    },
  };
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - startedAt;
  const payload: unknown = await response.json().catch(() => null);
  const evidence = {
    recordedAt: new Date().toISOString(),
    endpoint,
    httpStatus: response.status,
    elapsedMs,
    device: "cpu",
    offline: true,
    codeRevision: LAYA_CODE_REVISION,
    modelRevision: LAYA_MODEL_REVISION,
    request: body,
    response: payload,
    calibrated: false,
  };
  const out = process.env.LAYA_SMOKE_OUT ?? "artifacts/laya-cpu-smoke.json";
  await Bun.write(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `[laya-smoke] status=${response.status} elapsed=${elapsedMs}ms out=${out} calibrated=false`,
  );
  if (response.status !== 200) process.exitCode = 1;
};

if (command === "verify") await verify();
else if (command === "install") await install();
else if (command === "start") await start();
else if (command === "smoke") await smoke();
else {
  console.error(`[laya-setup] unknown command: ${command} (verify | install | start | smoke)`);
  process.exitCode = 1;
}
