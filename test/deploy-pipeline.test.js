import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const deployScript = join(repoRoot, "deploy/deploy.sh");
const deployWorkflow = join(repoRoot, ".github/workflows/deploy.yml");
const nginxConfig = join(repoRoot, "deploy/nginx.conf");
const composeFile = join(repoRoot, "compose.ha.yaml");

const OLD_SHA = "1".repeat(40);
const NEW_SHA = "2".repeat(40);
const IMAGE_REPO = "chrisxhleung/scaletag";

function createHarness({
  remoteMain = NEW_SHA,
  backupInstalled = false,
  failApp2Revision = "",
  initialState = null,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "scaletag-deploy-test-"));
  const binDir = join(root, "bin");
  const releaseDir = join(root, "ScaleTag/release");
  const envFile = join(root, "etc/scaletag-fresh/scaletag.env");
  const lockFile = join(root, "run/lock/scaletag-pipeline.lock");
  const stateFile = join(root, "state.json");
  const logFile = join(root, "calls.jsonl");

  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    stateFile,
    JSON.stringify(
      initialState ?? {
        containers: {},
        pulled: [],
        tagged: [],
        ingressRevision: "",
      },
    ),
  );
  writeFileSync(logFile, "");

  const writeShim = (name, source) => {
    const filePath = join(binDir, name);
    writeFileSync(filePath, source);
    chmodSync(filePath, 0o755);
  };

  writeShim(
    "git",
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "ls-remote" ]]; then
  printf '%s\\trefs/heads/main\\n' ${JSON.stringify(remoteMain)}
  exit 0
fi
echo "Unexpected git args: $*" >&2
exit 1
`,
  );

  writeShim(
    "systemctl",
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ cmd: "systemctl", args }) + "\\n");
if (args[0] === "list-unit-files" && args[1] === "scaletag-backup.service") {
  if (${backupInstalled ? "true" : "false"}) {
    process.stdout.write("UNIT FILE                STATE   PRESET\\n");
    process.stdout.write("scaletag-backup.service  static  -\\n\\n");
    process.stdout.write("1 unit files listed.\\n");
    process.exit(0);
  }
  process.stdout.write("UNIT FILE STATE PRESET\\n\\n0 unit files listed.\\n");
  process.exit(1);
}
if (args[0] === "start" && args[1] === "scaletag-backup.service") {
  process.exit(0);
}
process.stderr.write("Unexpected systemctl args: " + args.join(" ") + "\\n");
process.exit(1);
`,
  );

  writeShim(
    "curl",
    `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const url = args.at(-1) || "";
const state = JSON.parse(readFileSync(${JSON.stringify(stateFile)}, "utf8"));
appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ cmd: "curl", url, ingressRevision: state.ingressRevision }) + "\\n");
if (!state.ingressRevision) {
  process.exit(7);
}
process.stdout.write(JSON.stringify({ status: "ok", revision: state.ingressRevision }));
`,
  );

  writeShim(
    "docker",
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const statePath = ${JSON.stringify(stateFile)};
const failApp2Rev = ${JSON.stringify(failApp2Revision)};
const state = JSON.parse(readFileSync(statePath, "utf8"));
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const log = (extra = {}) => appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ cmd: "docker", args, ...extra }) + "\\n");

const sub = args[0];
if (sub === "ps") {
  log();
  let service = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--filter" && args[i + 1]?.startsWith("label=com.docker.compose.service=")) {
      service = args[i + 1].slice("label=com.docker.compose.service=".length);
    }
  }
  const c = state.containers[service];
  if (c?.running) process.stdout.write(c.id + "\\n");
  process.exit(0);
}
if (sub === "inspect") {
  log();
  const fmt = args[args.indexOf("--format") + 1];
  const id = args.at(-1);
  const c = Object.values(state.containers).find((item) => item.id === id);
  if (!c) process.exit(1);
  if (fmt.includes(".Config.Env")) {
    process.stdout.write("APP_REVISION=" + c.revision + "\\n");
  } else if (fmt === "{{.Image}}") {
    process.stdout.write(c.image + "\\n");
  }
  process.exit(0);
}
if (sub === "pull") {
  log();
  const img = args.at(-1);
  state.pulled.push(img);
  save();
  process.exit(0);
}
if (sub === "image" && args[1] === "inspect") {
  log();
  process.exit(state.pulled.includes(args[2]) ? 0 : 1);
}
if (sub === "tag") {
  log();
  state.tagged.push([args[1], args[2]]);
  save();
  process.exit(0);
}
if (sub === "exec") {
  const id = args[1];
  const expectedRev = args.at(-2);
  const slot = args.at(-1);
  const c = state.containers[slot];
  const ok = Boolean(c && c.running && c.id === id && c.revision === expectedRev && !(slot === "app2" && expectedRev === failApp2Rev));
  log({ slot, expectedRev, ok });
  process.exit(ok ? 0 : 1);
}
if (sub === "compose") {
  const fIdx = args.indexOf("-f");
  const composePath = fIdx >= 0 ? args[fIdx + 1] : "";
  const envIdx = args.indexOf("--env-file");
  const envPath = envIdx >= 0 ? args[envIdx + 1] : "";
  const upIdx = args.indexOf("up");
  log({
    composePath,
    envPath,
    APP1_IMAGE: process.env.APP1_IMAGE || "",
    APP2_IMAGE: process.env.APP2_IMAGE || "",
    APP1_REVISION: process.env.APP1_REVISION || "",
    APP2_REVISION: process.env.APP2_REVISION || "",
  });
  if (upIdx >= 0) {
    const target = args.at(-1);
    if (target === "app1") {
      state.containers.app1 = {
        id: "ctr-app1-" + process.env.APP1_REVISION.slice(0, 7),
        image: process.env.APP1_IMAGE,
        revision: process.env.APP1_REVISION,
        running: true,
      };
      state.ingressRevision = process.env.APP1_REVISION;
    } else if (target === "app2") {
      state.containers.app2 = {
        id: "ctr-app2-" + process.env.APP2_REVISION.slice(0, 7),
        image: process.env.APP2_IMAGE,
        revision: process.env.APP2_REVISION,
        running: true,
      };
    } else if (target === "ingress") {
      const recreates = (state.containers.ingress?.recreates ?? 0) + 1;
      state.containers.ingress = {
        id: "ctr-ingress-" + recreates,
        recreates,
        running: true,
      };
    } else {
      state.containers.app1 = {
        id: "ctr-app1-" + process.env.APP1_REVISION.slice(0, 7),
        image: process.env.APP1_IMAGE,
        revision: process.env.APP1_REVISION,
        running: true,
      };
      state.containers.app2 = {
        id: "ctr-app2-" + process.env.APP2_REVISION.slice(0, 7),
        image: process.env.APP2_IMAGE,
        revision: process.env.APP2_REVISION,
        running: true,
      };
      state.ingressRevision = process.env.APP1_REVISION;
    }
    save();
    process.exit(0);
  }
  if (args.includes("ps")) {
    process.exit(0);
  }
}
process.stderr.write("Unexpected docker args: " + args.join(" ") + "\\n");
process.exit(1);
`,
  );

  const runDeploy = (args, extraEnv = {}) =>
    spawnSync("bash", [deployScript, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        SCALETAG_DEPLOY_TEST_MODE: "1",
        SCALETAG_TEST_PATH: binDir,
        SCALETAG_TEST_LOCK_FILE: lockFile,
        SCALETAG_TEST_RELEASE_DIR: releaseDir,
        SCALETAG_TEST_ENV_FILE: envFile,
        SCALETAG_TEST_REPO: "https://example.invalid/ScaleTag.git",
        SCALETAG_TEST_SLEEP_SECONDS: "0",
        SCALETAG_TEST_POLL_SLEEP: "0",
        ...extraEnv,
      },
    });

  const readCalls = () =>
    readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

  const readState = () => JSON.parse(readFileSync(stateFile, "utf8"));

  const cleanup = () => rmSync(root, { recursive: true, force: true });

  return { root, releaseDir, envFile, runDeploy, readCalls, readState, cleanup };
}

test("deploy.yml preserves ocihost job and defines independent deploy-jp job for ocijphost", () => {
  const syntax = spawnSync("bash", ["-n", deployScript], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);

  const workflow = readFileSync(deployWorkflow, "utf8");
  assert.match(workflow, /^\s{2}deploy:\s*$/m);
  assert.match(workflow, /runs-on:\s*\[self-hosted,\s*ocihost\]/);
  assert.match(workflow, /^\s{2}deploy-jp:\s*$/m);
  assert.match(workflow, /runs-on:\s*\[self-hosted,\s*ocijphost\]/);
  assert.match(workflow, /DEPLOY_PUBLIC_ORIGIN:\s*https:\/\/asia\.scaletag\.top/);
  assert.match(workflow, /"\$GITHUB_WORKSPACE\/deploy\/deploy\.sh"\s+"\$DEPLOY_REVISION"\s+"\$DEPLOY_IMAGE"\s+"\$DEPLOY_PUBLIC_ORIGIN"/);

  const deployJpSection = workflow.slice(workflow.indexOf("  deploy-jp:"));
  assert.equal(/\bneeds\s*:/.test(deployJpSection), false);
});

test("deploy.sh enforces root unless SCALETAG_DEPLOY_TEST_MODE=1 is set by non-root test runner", () => {
  if (process.getuid?.() === 0) return;
  const result = spawnSync("bash", [deployScript, NEW_SHA, `${IMAGE_REPO}:${NEW_SHA}`], {
    encoding: "utf8",
    env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Root required/);
});

test("deploy.sh bootstraps a fresh host (release templates, env file, full compose up -d, readiness checks)", () => {
  const h = createHarness({ remoteMain: NEW_SHA, backupInstalled: false });
  try {
    const result = h.runDeploy([NEW_SHA, `${IMAGE_REPO}:${NEW_SHA}`, "https://asia.scaletag.top"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Created initial environment file/);
    assert.match(result.stdout, /Skipping pre-deployment backup/);
    assert.match(result.stdout, new RegExp(`Bootstrapped and deployed ${NEW_SHA}`));

    const composeTarget = join(h.releaseDir, "compose.ha.yaml");
    const nginxTarget = join(h.releaseDir, "deploy/nginx.conf");
    assert.equal(readFileSync(composeTarget, "utf8"), readFileSync(join(repoRoot, "compose.ha.yaml"), "utf8"));
    assert.equal(readFileSync(nginxTarget, "utf8"), readFileSync(join(repoRoot, "deploy/nginx.conf"), "utf8"));
    assert.equal(statSync(composeTarget).mode & 0o777, 0o644);
    assert.equal(statSync(nginxTarget).mode & 0o777, 0o644);

    assert.equal(statSync(join(h.root, "etc/scaletag-fresh")).mode & 0o777, 0o700);
    assert.equal(statSync(h.envFile).mode & 0o777, 0o600);

    const envLines = readFileSync(h.envFile, "utf8").trim().split("\n");
    const envMap = Object.fromEntries(envLines.map((line) => line.split("=")));
    assert.deepEqual(Object.keys(envMap), [
      "PUBLIC_ORIGIN",
      "SCALETAG_PORT",
      "SCALETAG_ENCRYPTION_KEY",
      "SCALETAG_UID",
      "SCALETAG_GID",
    ]);
    assert.equal(envMap.PUBLIC_ORIGIN, "https://asia.scaletag.top");
    assert.equal(envMap.SCALETAG_PORT, "3000");
    assert.match(envMap.SCALETAG_ENCRYPTION_KEY, /^[0-9a-f]{64}$/);
    assert.equal(envMap.SCALETAG_UID, "1000");
    assert.equal(envMap.SCALETAG_GID, "1000");
    assert.equal((result.stdout + result.stderr).includes(envMap.SCALETAG_ENCRYPTION_KEY), false);

    const calls = h.readCalls();
    assert.equal(
      calls.some((c) => c.cmd === "systemctl" && c.args[0] === "start"),
      false,
    );
    const composeUp = calls.find((c) => c.cmd === "docker" && c.args[0] === "compose" && c.args.includes("up"));
    assert.ok(composeUp);
    assert.deepEqual(composeUp.args.slice(-2), ["up", "-d"]);
    assert.equal(calls.some((c) => c.cmd === "docker" && c.args[0] === "exec" && c.slot === "app1" && c.ok), true);
    assert.equal(calls.some((c) => c.cmd === "docker" && c.args[0] === "exec" && c.slot === "app2" && c.ok), true);
    assert.equal(calls.some((c) => c.cmd === "curl" && c.ingressRevision === NEW_SHA), true);
  } finally {
    h.cleanup();
  }
});

test("deploy.sh never overwrites existing scaletag.env and reports already deployed when both slots match", () => {
  const existingEnv =
    "PUBLIC_ORIGIN=https://ca.example.top\nSCALETAG_PORT=3000\nSCALETAG_ENCRYPTION_KEY=" +
    "a".repeat(64) +
    "\nSCALETAG_UID=1000\nSCALETAG_GID=1000\n";
  const h = createHarness({
    remoteMain: NEW_SHA,
    initialState: {
      containers: {
        app1: { id: "ctr-app1", image: `scaletag:${NEW_SHA}`, revision: NEW_SHA, running: true },
        app2: { id: "ctr-app2", image: `scaletag:${NEW_SHA}`, revision: NEW_SHA, running: true },
      },
      pulled: [],
      tagged: [],
      ingressRevision: NEW_SHA,
    },
  });
  try {
    mkdirSync(join(h.root, "etc/scaletag-fresh"), { mode: 0o700, recursive: true });
    writeFileSync(h.envFile, existingEnv, { mode: 0o600 });

    const result = h.runDeploy([NEW_SHA, `${IMAGE_REPO}:${NEW_SHA}`, "https://asia.scaletag.top"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Already deployed ${NEW_SHA}`));
    assert.equal(readFileSync(h.envFile, "utf8"), existingEnv);
    assert.equal(h.readCalls().some((c) => c.cmd === "docker" && c.args[0] === "pull"), false);
  } finally {
    h.cleanup();
  }
});

test("deploy.sh runs backup and app2 -> app1 rolling update on existing ocihost deployment", () => {
  const existingEnv =
    "PUBLIC_ORIGIN=https://scaletag.top\nSCALETAG_PORT=3000\nSCALETAG_ENCRYPTION_KEY=" +
    "b".repeat(64) +
    "\nSCALETAG_UID=1000\nSCALETAG_GID=1000\n";
  const h = createHarness({
    remoteMain: NEW_SHA,
    backupInstalled: true,
    initialState: {
      containers: {
        app1: { id: "ctr-app1-old", image: `scaletag:${OLD_SHA}`, revision: OLD_SHA, running: true },
        app2: { id: "ctr-app2-old", image: `scaletag:${OLD_SHA}`, revision: OLD_SHA, running: true },
      },
      pulled: [],
      tagged: [],
      ingressRevision: OLD_SHA,
    },
  });
  try {
    mkdirSync(join(h.root, "etc/scaletag-fresh"), { mode: 0o700, recursive: true });
    writeFileSync(h.envFile, existingEnv, { mode: 0o600 });

    const result = h.runDeploy([NEW_SHA, `${IMAGE_REPO}:${NEW_SHA}`]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Running pre-deployment backup/);
    assert.match(result.stdout, new RegExp(`Deployed ${NEW_SHA}`));
    assert.equal(readFileSync(h.envFile, "utf8"), existingEnv);

    const calls = h.readCalls();
    const startIdx = calls.findIndex((c) => c.cmd === "systemctl" && c.args[0] === "start");
    const app2Idx = calls.findIndex((c) => c.cmd === "docker" && c.args[0] === "compose" && c.args.at(-1) === "app2");
    const app1Idx = calls.findIndex((c) => c.cmd === "docker" && c.args[0] === "compose" && c.args.at(-1) === "app1");
    assert.ok(startIdx >= 0 && app2Idx > startIdx && app1Idx > app2Idx);
    assert.equal(h.readState().ingressRevision, NEW_SHA);
  } finally {
    h.cleanup();
  }
});

test("deploy.sh rolls back app2 and app1 to previous revisions when app2 readiness fails", () => {
  const existingEnv =
    "PUBLIC_ORIGIN=https://asia.scaletag.top\nSCALETAG_PORT=3000\nSCALETAG_ENCRYPTION_KEY=" +
    "c".repeat(64) +
    "\nSCALETAG_UID=1000\nSCALETAG_GID=1000\n";
  const h = createHarness({
    remoteMain: NEW_SHA,
    backupInstalled: false,
    failApp2Revision: NEW_SHA,
    initialState: {
      containers: {
        app1: { id: "ctr-app1-old", image: `scaletag:${OLD_SHA}`, revision: OLD_SHA, running: true },
        app2: { id: "ctr-app2-old", image: `scaletag:${OLD_SHA}`, revision: OLD_SHA, running: true },
      },
      pulled: [],
      tagged: [],
      ingressRevision: OLD_SHA,
    },
  });
  try {
    mkdirSync(join(h.root, "etc/scaletag-fresh"), { mode: 0o700, recursive: true });
    writeFileSync(h.envFile, existingEnv, { mode: 0o600 });

    const result = h.runDeploy([NEW_SHA, `${IMAGE_REPO}:${NEW_SHA}`, "https://asia.scaletag.top"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Deployment failed; restoring previous images/);
    assert.match(result.stderr, /Previous images restored/);
    assert.equal(h.readState().containers.app1.revision, OLD_SHA);
    assert.equal(h.readState().containers.app2.revision, OLD_SHA);
  } finally {
    h.cleanup();
  }
});

test("deploy.sh rejects invalid revision, invalid image, stale revision, and non-https origin before creating scaletag.env", () => {
  const h = createHarness({ remoteMain: NEW_SHA });
  try {
    assert.equal(h.runDeploy(["not-a-sha", `${IMAGE_REPO}:${NEW_SHA}`]).status, 1);
    assert.equal(h.runDeploy([NEW_SHA, "invalid_image"]).status, 1);
    assert.equal(h.runDeploy([OLD_SHA, `${IMAGE_REPO}:${OLD_SHA}`]).status, 1);
    assert.equal(h.runDeploy([NEW_SHA, `${IMAGE_REPO}:${NEW_SHA}`, "http://asia.scaletag.top"]).status, 1);
    assert.equal(existsSync(h.envFile), false);
  } finally {
    h.cleanup();
  }
});

function extractBraceBlock(source, headerRegex) {
  const match = headerRegex.exec(source);
  assert.ok(match, `Missing block matching ${headerRegex}`);
  const openBraceIdx = source.indexOf("{", match.index);
  assert.ok(openBraceIdx >= 0, `Missing opening brace for ${headerRegex}`);
  let depth = 0;
  for (let i = openBraceIdx; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        return { start: match.index, end: i + 1, body: source.slice(openBraceIdx + 1, i) };
      }
    }
  }
  assert.fail(`Unbalanced braces in block ${headerRegex}`);
}

test("deploy/nginx.conf blocks public/proxied /readyz and /healthz requests while allowing local probes", () => {
  const conf = readFileSync(nginxConfig, "utf8");
  const strippedComments = conf.replace(/#[^\n]*/g, "");

  let braceDepth = 0;
  for (const ch of strippedComments) {
    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    assert.ok(braceDepth >= 0, "Unexpected closing brace in nginx.conf");
  }
  assert.equal(braceDepth, 0, "Unbalanced braces in nginx.conf");

  assert.equal(/\bif\s*\([^)]*\|\|[^)]*\)/.test(strippedComments), false, "nginx if does not support ||");

  const serverBlock = extractBraceBlock(strippedComments, /\bserver\s*\{/);
  const probeLocMatch = /location\s+(~\*?)\s+(\S+)\s*\{/.exec(serverBlock.body);
  assert.ok(probeLocMatch, "Missing probe regex location block inside server {}");
  const probeBlock = extractBraceBlock(serverBlock.body, /location\s+~\*?\s+\^\/\(healthz\|readyz\|api\/stats\)\(\/\|\$\)\s*\{/);
  const fallbackLocIdx = serverBlock.body.search(/location\s+\/\s*\{/);
  assert.ok(fallbackLocIdx > probeBlock.end, "Probe location block must appear before location /");

  const block = probeBlock.body;
  assert.match(block, /set\s+\$block_probe\s+0\s*;/);
  assert.match(block, /if\s*\(\s*\$http_cf_connecting_ip\s*!=\s*""\s*\)\s*\{\s*set\s+\$block_probe\s+1\s*;\s*\}/);
  assert.match(block, /if\s*\(\s*\$http_cf_ray\s*!=\s*""\s*\)\s*\{\s*set\s+\$block_probe\s+1\s*;\s*\}/);
  assert.match(block, /if\s*\(\s*\$http_x_forwarded_for\s*!=\s*""\s*\)\s*\{\s*set\s+\$block_probe\s+1\s*;\s*\}/);
  assert.match(block, /if\s*\(\s*\$http_forwarded\s*!=\s*""\s*\)\s*\{\s*set\s+\$block_probe\s+1\s*;\s*\}/);
  assert.match(
    block,
    /if\s*\(\s*\$host\s+!~\*\s+\^\(127\\\.0\\\.0\\\.1\|localhost\|ingress\)\(:?\[0-9\]\+\)\?\$\s*\)\s*\{\s*set\s+\$block_probe\s+1\s*;\s*\}/,
  );
  assert.match(block, /if\s*\(\s*\$block_probe\s*=\s*1\s*\)\s*\{\s*return\s+404\s*;\s*\}/);
  assert.match(block, /proxy_pass\s+http:\/\/scaletag\s*;/);
  assert.match(block, /proxy_http_version\s+1\.1\s*;/);
  assert.match(block, /proxy_set_header\s+Connection\s+""\s*;/);
  assert.match(block, /proxy_set_header\s+Host\s+\$http_host\s*;/);
  assert.match(block, /proxy_set_header\s+X-ScaleTag-Local-Stats\s+1\s*;/);
  assert.match(serverBlock.body.slice(fallbackLocIdx), /proxy_set_header\s+X-ScaleTag-Local-Stats\s+""\s*;/);
  assert.match(block, /proxy_cache\s+off\s*;/);

  const locFlags = probeLocMatch[1] === "~*" ? "i" : "";
  const locRegex = new RegExp(probeLocMatch[2], locFlags);
  const hostMatch = /\$host\s+!~\*\s+(\S+)\s*\)/.exec(block);
  assert.ok(hostMatch);
  const hostRegex = new RegExp(hostMatch[1], "i");
  const headerVars = [...block.matchAll(/\$http_([a-z0-9_]+)\s*!=\s*""/g)].map((m) => m[1]);
  assert.deepEqual(headerVars.sort(), ["cf_connecting_ip", "cf_ray", "forwarded", "x_forwarded_for"]);

  const evaluateNginx = (path, headers = {}) => {
    if (!locRegex.test(path)) return "location_slash";
    const normHeaders = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase().replace(/-/g, "_"), v]),
    );
    let blockProbe = 0;
    for (const hVar of headerVars) {
      if ((normHeaders[hVar] ?? "") !== "") blockProbe = 1;
    }
    const rawHost = normHeaders.host ?? "";
    const nginxHost = rawHost.replace(/:\d+$/, "");
    if (!hostRegex.test(rawHost) || !hostRegex.test(nginxHost)) blockProbe = 1;
    return blockProbe === 1 ? 404 : "proxy";
  };

  for (const path of ["/readyz", "/healthz", "/readyz/", "/healthz/live", "/READYZ", "/Healthz", "/api/stats", "/API/Stats/"]) {
    assert.equal(evaluateNginx(path, { Host: "asia.scaletag.top" }), 404, `public Host must block ${path}`);
    assert.equal(evaluateNginx(path, { Host: "www.scaletag.top" }), 404, `www Host must block ${path}`);
    assert.equal(evaluateNginx(path, { Host: "127.0.0.1.evil.test" }), 404, `prefix spoof Host must block ${path}`);
    assert.equal(evaluateNginx(path, { Host: "evil-ingress" }), 404, `suffix spoof Host must block ${path}`);
    assert.equal(evaluateNginx(path, {}), 404, `missing Host must block ${path}`);

    for (const localHost of ["127.0.0.1:3000", "127.0.0.1", "localhost:3000", "ingress:8080", "ingress"]) {
      assert.equal(evaluateNginx(path, { Host: localHost }), "proxy", `local Host ${localHost} must allow ${path}`);
      assert.equal(
        evaluateNginx(path, { Host: localHost, "CF-Connecting-IP": "203.0.113.10" }),
        404,
        `CF-Connecting-IP must block ${path} even with ${localHost}`,
      );
      assert.equal(
        evaluateNginx(path, { Host: localHost, "Cf-Ray": "8f1234abcd-NRT" }),
        404,
        `Cf-Ray must block ${path} even with ${localHost}`,
      );
      assert.equal(
        evaluateNginx(path, { Host: localHost, "X-Forwarded-For": "203.0.113.10" }),
        404,
        `X-Forwarded-For must block ${path} even with ${localHost}`,
      );
      assert.equal(
        evaluateNginx(path, { Host: localHost, Forwarded: "for=203.0.113.10" }),
        404,
        `Forwarded must block ${path} even with ${localHost}`,
      );
    }
  }

  for (const appPath of ["/", "/api/posts", "/healthz-other", "/readyz2"]) {
    assert.equal(evaluateNginx(appPath, { Host: "asia.scaletag.top", "CF-Connecting-IP": "203.0.113.10" }), "location_slash");
  }
});

test("deploy.sh recreates ingress only when nginx.conf or compose.ha.yaml changes", () => {
  const existingEnv =
    "PUBLIC_ORIGIN=https://asia.scaletag.top\nSCALETAG_PORT=3000\nSCALETAG_ENCRYPTION_KEY=" +
    "d".repeat(64) +
    "\nSCALETAG_UID=1000\nSCALETAG_GID=1000\n";
  const repoCompose = readFileSync(composeFile, "utf8");
  const repoNginx = readFileSync(nginxConfig, "utf8");

  const seedRelease = (releaseDir, { composeContent = repoCompose, nginxContent = repoNginx } = {}) => {
    mkdirSync(join(releaseDir, "deploy"), { recursive: true });
    writeFileSync(join(releaseDir, "compose.ha.yaml"), composeContent, { mode: 0o644 });
    writeFileSync(join(releaseDir, "deploy/nginx.conf"), nginxContent, { mode: 0o644 });
  };

  // 1. Rolling update when nginx.conf changes -> recreates ingress before final ingress readiness check
  {
    const h = createHarness({
      remoteMain: NEW_SHA,
      initialState: {
        containers: {
          app1: { id: "ctr-app1-old", image: `scaletag:${OLD_SHA}`, revision: OLD_SHA, running: true },
          app2: { id: "ctr-app2-old", image: `scaletag:${OLD_SHA}`, revision: OLD_SHA, running: true },
        },
        pulled: [],
        tagged: [],
        ingressRevision: OLD_SHA,
      },
    });
    try {
      mkdirSync(join(h.root, "etc/scaletag-fresh"), { mode: 0o700, recursive: true });
      writeFileSync(h.envFile, existingEnv, { mode: 0o600 });
      seedRelease(h.releaseDir, { nginxContent: "# stale nginx\n" });

      const result = h.runDeploy([NEW_SHA, `${IMAGE_REPO}:${NEW_SHA}`, "https://asia.scaletag.top"]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(h.releaseDir, "deploy/nginx.conf"), "utf8"), repoNginx);

      const calls = h.readCalls();
      const app2Idx = calls.findIndex((c) => c.cmd === "docker" && c.args[0] === "compose" && c.args.at(-1) === "app2");
      const app1Idx = calls.findIndex((c) => c.cmd === "docker" && c.args[0] === "compose" && c.args.at(-1) === "app1");
      const ingressIdx = calls.findIndex(
        (c) =>
          c.cmd === "docker" &&
          c.args[0] === "compose" &&
          c.args.slice(-5).join(" ") === "up -d --no-deps --force-recreate ingress",
      );
      const curlIdx = calls.findIndex((c) => c.cmd === "curl" && c.ingressRevision === NEW_SHA);
      assert.ok(app2Idx >= 0 && app1Idx > app2Idx && ingressIdx > app1Idx && curlIdx > ingressIdx);
    } finally {
      h.cleanup();
    }
  }

  // 2. Rolling update when compose.ha.yaml changes -> recreates ingress before final ingress readiness check
  {
    const h = createHarness({
      remoteMain: NEW_SHA,
      initialState: {
        containers: {
          app1: { id: "ctr-app1-old", image: `scaletag:${OLD_SHA}`, revision: OLD_SHA, running: true },
          app2: { id: "ctr-app2-old", image: `scaletag:${OLD_SHA}`, revision: OLD_SHA, running: true },
        },
        pulled: [],
        tagged: [],
        ingressRevision: OLD_SHA,
      },
    });
    try {
      mkdirSync(join(h.root, "etc/scaletag-fresh"), { mode: 0o700, recursive: true });
      writeFileSync(h.envFile, existingEnv, { mode: 0o600 });
      seedRelease(h.releaseDir, { composeContent: "# stale compose\n" });

      const result = h.runDeploy([NEW_SHA, `${IMAGE_REPO}:${NEW_SHA}`, "https://asia.scaletag.top"]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(h.releaseDir, "compose.ha.yaml"), "utf8"), repoCompose);

      const calls = h.readCalls();
      const app1Idx = calls.findIndex((c) => c.cmd === "docker" && c.args[0] === "compose" && c.args.at(-1) === "app1");
      const ingressIdx = calls.findIndex(
        (c) =>
          c.cmd === "docker" &&
          c.args[0] === "compose" &&
          c.args.slice(-5).join(" ") === "up -d --no-deps --force-recreate ingress",
      );
      const curlIdx = calls.findIndex((c) => c.cmd === "curl" && c.ingressRevision === NEW_SHA);
      assert.ok(app1Idx >= 0 && ingressIdx > app1Idx && curlIdx > ingressIdx);
    } finally {
      h.cleanup();
    }
  }

  // 3. Rolling update when neither nginx.conf nor compose.ha.yaml changes -> skips ingress recreation
  {
    const h = createHarness({
      remoteMain: NEW_SHA,
      initialState: {
        containers: {
          app1: { id: "ctr-app1-old", image: `scaletag:${OLD_SHA}`, revision: OLD_SHA, running: true },
          app2: { id: "ctr-app2-old", image: `scaletag:${OLD_SHA}`, revision: OLD_SHA, running: true },
        },
        pulled: [],
        tagged: [],
        ingressRevision: OLD_SHA,
      },
    });
    try {
      mkdirSync(join(h.root, "etc/scaletag-fresh"), { mode: 0o700, recursive: true });
      writeFileSync(h.envFile, existingEnv, { mode: 0o600 });
      seedRelease(h.releaseDir);

      const result = h.runDeploy([NEW_SHA, `${IMAGE_REPO}:${NEW_SHA}`, "https://asia.scaletag.top"]);
      assert.equal(result.status, 0, result.stderr);

      const calls = h.readCalls();
      assert.equal(
        calls.some((c) => c.cmd === "docker" && c.args[0] === "compose" && c.args.includes("ingress")),
        false,
      );
    } finally {
      h.cleanup();
    }
  }

  // 4. Already-deployed revision when nginx.conf changes -> recreates ingress without pulling image
  {
    const h = createHarness({
      remoteMain: NEW_SHA,
      initialState: {
        containers: {
          app1: { id: "ctr-app1", image: `scaletag:${NEW_SHA}`, revision: NEW_SHA, running: true },
          app2: { id: "ctr-app2", image: `scaletag:${NEW_SHA}`, revision: NEW_SHA, running: true },
        },
        pulled: [],
        tagged: [],
        ingressRevision: NEW_SHA,
      },
    });
    try {
      mkdirSync(join(h.root, "etc/scaletag-fresh"), { mode: 0o700, recursive: true });
      writeFileSync(h.envFile, existingEnv, { mode: 0o600 });
      seedRelease(h.releaseDir, { nginxContent: "# stale nginx\n" });

      const result = h.runDeploy([NEW_SHA, `${IMAGE_REPO}:${NEW_SHA}`, "https://asia.scaletag.top"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`Already deployed ${NEW_SHA}`));
      assert.equal(readFileSync(join(h.releaseDir, "deploy/nginx.conf"), "utf8"), repoNginx);

      const calls = h.readCalls();
      assert.equal(calls.some((c) => c.cmd === "docker" && c.args[0] === "pull"), false);
      const ingressIdx = calls.findIndex(
        (c) =>
          c.cmd === "docker" &&
          c.args[0] === "compose" &&
          c.args.slice(-5).join(" ") === "up -d --no-deps --force-recreate ingress",
      );
      const curlIdx = calls.findIndex((c) => c.cmd === "curl" && c.ingressRevision === NEW_SHA);
      assert.ok(ingressIdx >= 0 && curlIdx > ingressIdx);
    } finally {
      h.cleanup();
    }
  }
});
