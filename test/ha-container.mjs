// Disposable project only. Never touches /ScaleTag, the real tunnel or live data.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const root = await mkdtemp(join(tmpdir(), "scaletag-ha-test-"));
const project = `scaletag-ha-test-${process.pid}`;
const revisions = Array.from({ length: 4 }, () => randomBytes(20).toString("hex"));
const [old, next, broken, primaryBroken] = revisions;
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise(r => reservation.close(r));
const origin = "https://scaletag.test", url = `http://127.0.0.1:${port}`;
const config = join(root, "compose.ha.yaml"), envfile = join(root, "demo.env");
const state = join(root, "state");
await mkdir(join(root, "deploy"));
await copyFile("compose.ha.yaml", config);
await copyFile("deploy/nginx.conf", join(root, "deploy/nginx.conf"));
await writeFile(envfile, `PUBLIC_ORIGIN=${origin}\nSCALETAG_PORT=${port}\nCREATE_LIMIT_PER_MINUTE=1000\n`, { mode: 0o600 });
const env = {
  ...process.env, HA_STATE_DIR: state, HA_COMPOSE: config, HA_ENV_FILE: envfile,
  HA_PROJECT: project, SCALETAG_DATA_SOURCE: "ha-data",
};
const docker = (...args) => execFileSync("docker", args, { env, encoding: "utf8", maxBuffer: 4e6 });
async function imageEnv() {
  const text = await readFile(join(state, "images.env"), "utf8");
  return Object.fromEntries(text.trim().split("\n").map(line => line.split("=")));
}
async function compose(...args) {
  return execFileSync("docker", ["compose", "-p", project, "--env-file", envfile, "-f", config, ...args],
    { env: { ...env, ...await imageEnv() }, encoding: "utf8", maxBuffer: 4e6 });
}
async function rollout(rev, success = true) {
  const release = join(root, "releases", rev);
  await mkdir(release, { recursive: true });
  const result = spawnSync("bash", [resolve("deploy/ha-rollout.sh")], {
    env: { ...env, HA_RELEASE: release }, encoding: "utf8", maxBuffer: 4e6,
    timeout: 240000,
  });
  console.log(result.stdout);
  if (success) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0, "Expected rollout rejection");
  return result.stdout + result.stderr;
}
async function request(path, data, cookie) {
  return fetch(url + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      connection: "close", ...(data === undefined ? {} : { origin, "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(20000),
  });
}
async function routed(slot, revision) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await request("/readyz");
      if (r.ok) {
        const d = await r.json();
        if (d.instance === slot && d.revision === revision) return d;
      } else await r.text();
    } catch { /* Passive detection may fail the request that discovers a crash. */ }
    await new Promise(r => setTimeout(r, 500));
  }
  assert.fail(`Ingress did not select ${slot} ${revision}`);
}
const input = {
  title: "Isolated HA demonstration", description: "", signature: "Test",
  options: ["A", "B"], images: [], location: { latitude: 0, longitude: 0 },
  retentionAccepted: true, mapVisible: true,
};
let sampler;
try {
  docker("tag", "scaletag:ha-test", `scaletag:${old}`);
  docker("tag", "scaletag:ha-test", `scaletag:${next}`);
  await rollout(old);
  const ingressId = (await compose("ps", "-q", "ingress")).trim();
  const containers = (await compose("ps", "-q")).trim().split(/\s+/);
  for (const id of containers) {
    const info = JSON.parse(docker("inspect", id))[0];
    assert.equal(info.HostConfig.ReadonlyRootfs, true);
    assert.ok(info.HostConfig.CapDrop.includes("ALL"));
    if (id === ingressId) {
      assert.ok(info.NetworkSettings.Ports["8080/tcp"].every(p => p.HostIp === "127.0.0.1"));
    } else assert.equal(info.HostConfig.PortBindings && Object.keys(info.HostConfig.PortBindings).length, 0);
  }
  await routed("app1", old);
  const created = await request("/api/polls", input);
  assert.equal(created.status, 201);
  const p = await created.json();
  const page = await request(`/api/polls/${p.id}`);
  const voter = page.headers.get("set-cookie").split(";")[0];
  assert.equal((await request(`/api/polls/${p.id}/votes`, { optionId: 1 }, voter)).status, 200);
  await compose("stop", "app1");
  await routed("app2", old);
  assert.equal((await (await request(`/api/polls/${p.id}`)).json()).totalVotes, 1);
  assert.equal((await request(`/api/polls/${p.id}/votes`, { optionId: 1 }, voter)).status, 409);
  const taskResponse = await request("/api/tasks", { ...input, description: "Help with the garden.", options: [], reward: "Coffee" });
  assert.equal(taskResponse.status, 201);
  const task = await taskResponse.json();
  const social = await request(`/api/posts/${task.id}/social`);
  const helper = social.headers.get("set-cookie").split(";")[0];
  const reply = { message: "I can help", email: "helper@example.com", contactAccepted: true };
  assert.equal((await request(`/api/posts/${task.id}/replies`, reply, helper)).status, 201);
  await compose("start", "app1");
  await routed("app1", old);
  assert.equal((await (await request("/api/posts")).json()).polls.length, 2);
  assert.equal((await (await request(`/api/posts/${task.id}/social`)).json()).replies[0].email, reply.email);
  assert.equal((await request(`/api/posts/${task.id}/replies`, reply, helper)).status, 429);
  console.log("PASS: failover/failback preserve posts, votes, deduplication and replies.");

  const worker = `
    const base='http://127.0.0.1:3000',id=process.argv[1],prefix=process.argv[2];
    for(let i=0;i<10;i++){
      const r=await fetch(base+'/api/polls/'+id+'/votes',{method:'POST',headers:{origin:'${origin}',
        'content-type':'application/json',cookie:'st_'+id+'='+prefix+String(i).padStart(62,'0')},body:'{"optionId":1}'});
      if(!r.ok)throw Error('vote '+r.status);
    }
    const r=await fetch(base+'/api/posts/'+id+'/likes',{method:'POST',headers:{origin:'${origin}',
      'content-type':'application/json',cookie:'ss_'+id+'='+'a'.repeat(64)},body:'{}'});
    if(!r.ok)throw Error('like '+r.status);
  `;
  const cenv = { ...env, ...await imageEnv() };
  await Promise.all(["app1", "app2"].map(async (slot, i) => {
    const child = spawn("docker", ["compose", "-p", project, "--env-file", envfile, "-f", config,
      "exec", "-T", slot, "node", "--input-type=module", "-e", worker, p.id, String(i).repeat(2)],
      { env: cenv, stdio: ["ignore", "pipe", "pipe"] });
    let errors = ""; child.stderr.on("data", c => errors += c);
    const [status] = await once(child, "exit"); assert.equal(status, 0, errors);
  }));
  assert.equal((await (await request(`/api/polls/${p.id}`)).json()).totalVotes, 21);
  assert.equal((await (await request(`/api/posts/${p.id}/social`)).json()).totalLikes, 1);
  console.log("PASS: simultaneous cross-container writes keep exact counters.");

  const stop = join(root, "stop-sampler"), report = join(root, "traffic.json");
  sampler = spawn(process.execPath, ["--input-type=module", "-e", `
    import {existsSync,writeFileSync} from 'node:fs';
    let count=0,errors=[],seen=new Set();
    while(!existsSync(process.argv[2])){
      try{const r=await fetch(process.argv[1]+'/readyz',{signal:AbortSignal.timeout(20000),headers:{connection:'close'}});
        if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();seen.add(d.instance+':'+d.revision);count++;
      }catch(e){errors.push(e.message)}
      await new Promise(r=>setTimeout(r,30));
    }
    writeFileSync(process.argv[3],JSON.stringify({count,errors,seen:[...seen]}));
  `, url, stop, report], { stdio: "inherit" });
  // A stopped standby must not prevent deployment while the primary is healthy.
  await compose("stop", "app2");
  const upgraded = await rollout(next);
  assert.match(upgraded, /Updated app2/);
  assert.match(upgraded, /Ingress failed over to app2/);
  await writeFile(stop, "stop");
  await once(sampler, "exit"); sampler = null;
  const traffic = JSON.parse(await readFile(report, "utf8"));
  assert.ok(traffic.count > 5);
  assert.deepEqual(traffic.errors, []);
  assert.ok(traffic.seen.includes(`app2:${next}`));
  assert.ok(traffic.seen.includes(`app1:${next}`));
  assert.equal((await compose("ps", "-q", "ingress")).trim(), ingressId);
  assert.equal((await (await request(`/api/polls/${p.id}`)).json()).totalVotes, 21);
  console.log("PASS: rolling update, automatic failback, uninterrupted GET samples", traffic);

  for (const [revision, command] of [[broken, "process.exit(42)"], [primaryBroken,
    "if(process.env.INSTANCE_ID==='app1')process.exit(42);else import('/app/src/server.js')"]]) {
    execFileSync("docker", ["build", "--tag", `scaletag:${revision}`, "-"], {
      env, input: `FROM scaletag:ha-test\nCMD ["node","-e",${JSON.stringify(command)}]\n`, stdio: ["pipe", "pipe", "pipe"],
    });
    const text = await rollout(revision, false);
    assert.match(text, revision === broken ? /primary was left serving/ : /attempted primary rollback/);
    await routed("app1", next);
    assert.equal((await (await request(`/api/polls/${p.id}`)).json()).totalVotes, 21);
  }
  await rollout(next);
  console.log("PASS: failed standby update and failed primary update recover safely.");
  console.log(docker("stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}", ...(await compose("ps", "-q")).trim().split(/\s+/)));
} catch (error) {
  try { console.error(await compose("ps", "--all")); console.error(await compose("logs", "--tail", "30")); } catch {}
  throw error;
} finally {
  sampler?.kill();
  try { await compose("down", "--volumes", "--remove-orphans"); } catch { /* Retain original test error. */ }
  for (const revision of revisions) spawnSync("docker", ["image", "rm", `scaletag:${revision}`], { env, stdio: "ignore" });
  await rm(root, { recursive: true, force: true });
}
