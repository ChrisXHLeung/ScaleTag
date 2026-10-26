// Runs only against an isolated Compose project and its disposable named volume.
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import assert from "node:assert/strict";

const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const project = `scaletag-container-test-${process.pid}`;
const origin = "https://scaletag.test";
const env = {
  ...process.env,
  PUBLIC_ORIGIN: origin,
  NODE_ENV: "production",
  SCALETAG_DATA_SOURCE: "poll-data",
  SCALETAG_PORT: String(port),
  SCALETAG_UID: "1000",
  SCALETAG_GID: "1000",
};
const composeArgs = [
  "compose",
  "--project-name",
  project,
  "--file",
  "compose.yaml",
];
const docker = (...args) =>
  execFileSync("docker", args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const compose = (...args) => docker(...composeArgs, ...args);
const url = `http://127.0.0.1:${port}`;
async function request(path, data, cookie) {
  return fetch(url + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      connection: "close",
      ...(data === undefined
        ? {}
        : { origin, "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(10000),
  });
}
try {
  compose("config", "--quiet");
  compose("up", "--detach", "--no-build", "--wait", "--wait-timeout", "60");
  console.log("Container started and healthy.");
  let id = compose("ps", "--quiet", "app").trim();
  let info = JSON.parse(docker("inspect", id))[0];
  assert.equal(info.State.Health.Status, "healthy");
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.equal(info.HostConfig.Memory, 256 * 1024 * 1024);
  assert.ok(info.HostConfig.CapDrop.includes("ALL"));
  assert.ok(info.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.ok(
    info.NetworkSettings.Ports["3000/tcp"].every(
      (binding) => binding.HostIp === "127.0.0.1",
    ),
  );
  assert.equal(compose("exec", "-T", "app", "id", "-u").trim(), "1000");
  assert.equal((await request("/healthz")).status, 200);
  assert.equal((await request("/create")).status, 200);
  const created = await request("/api/polls", {
    title: "Isolated container test",
    description: "",
    signature: "Test",
    options: ["A", "B"],
    images: [],
    location: { latitude: 0, longitude: 0 },
    retentionAccepted: true,
  });
  assert.equal(created.status, 201);
  const poll = await created.json();
  const page = await request(`/api/polls/${poll.id}`);
  const cookieHeader = page.headers.get("set-cookie");
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=Strict/);
  const cookie = cookieHeader.split(";")[0];
  assert.equal(
    (await request(`/api/polls/${poll.id}/votes`, { optionId: 1 }, cookie))
      .status,
    200,
  );
  const png = await request(`/api/polls/${poll.id}/qr.png`);
  assert.equal(
    Buffer.from(await png.arrayBuffer())
      .subarray(0, 8)
      .toString("hex"),
    "89504e470d0a1a0a",
  );
  const secondWriter = spawnSync(
    "docker",
    [...composeArgs, "exec", "-T", "app", "scaletag-entrypoint", "true"],
    { env, encoding: "utf8" },
  );
  assert.equal(
    secondWriter.status,
    1,
    "A second writer must not acquire the data lock",
  );
  console.log("Poll, vote, QR and exclusive writer lock verified.");
  compose("stop", "--timeout", "15", "app");
  info = JSON.parse(docker("inspect", id))[0];
  assert.equal(
    info.State.ExitCode,
    0,
    "SIGTERM should stop the application cleanly",
  );
  compose(
    "up",
    "--detach",
    "--no-build",
    "--force-recreate",
    "--wait",
    "--wait-timeout",
    "60",
  );
  console.log("Container recreated; checking persisted data.");
  const restored = await (
    await request(`/api/polls/${poll.id}`, undefined, cookie)
  ).json();
  assert.equal(restored.totalVotes, 1);
  assert.equal(restored.options[0].votes, 1);
  assert.equal(restored.hasVoted, true);
  assert.equal(
    (await request(`/api/polls/${poll.id}/votes`, { optionId: 2 }, cookie))
      .status,
    409,
  );
  console.log(
    "PASS: container build/start, non-root user, read-only root, loopback publishing, health, poll/vote/QR, writer lock, SIGTERM, persistence and deduplication after recreation.",
  );
} catch (error) {
  try {
    console.error(compose("logs", "--tail", "30", "app"));
  } catch {}
  throw error;
} finally {
  // This project always uses its own test volume; never an operator's bind mount.
  compose("down", "--volumes", "--remove-orphans");
}
