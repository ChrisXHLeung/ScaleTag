import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decryptSecret, deriveClaim, encryptSecret } from "../public/secrex-crypto.js";
import { createApp } from "../src/app.js";
import { SecrexStore } from "../src/secrex-store.js";
import { PollStore } from "../src/store.js";

const token = size => randomBytes(size).toString("base64url");

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "scaletag-secrex-test-"));
  let now = Date.now(), app;
  const clock = () => now;
  const store = new PollStore(directory, { clock });
  await store.init();
  const secrex = new SecrexStore(directory, { clock });
  await secrex.init();
  const server = createServer((req, res) => app(req, res)).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await secrex.close();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  app = createApp(store, { origin, secrex });
  function post(path, body) {
    return fetch(origin + "/api/secrex" + path, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async function create() {
    const envelope = { id: token(16), claim: token(32), body: token(100),
      bodyNonce: token(12), wrapped: token(48), wrapNonce: token(12) };
    assert.equal((await post("/", envelope)).status, 201);
    return envelope;
  }
  return { origin, post, create, advance: ms => { now += ms; }, secrex };
}

test("Secrex preview and wrong credential preserve the secret; one session wins and can end", async (t) => {
  const f = await fixture(t);
  const { id, claim, body } = await f.create();
  const saved = f.secrex.db.prepare("SELECT envelope, verifier FROM secrex_payload WHERE id=?").get(id);
  assert.match(saved.verifier, /^\$argon2id\$/);
  assert.ok(!JSON.stringify(saved).includes(claim));
  const route = "/" + id;
  const preview = await fetch(f.origin + "/secrex" + route);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("cache-control"), /no-store/);
  const qr = await fetch(f.origin + "/api/secrex" + route + "/qr.png");
  assert.equal(qr.headers.get("content-type"), "image/png");
  assert.equal((await f.post(route + "/claim", { claim: token(32), session: token(32) })).ok, false);
  const sessions = [token(32), token(32)];
  const attempts = await Promise.all(sessions.map(session => f.post(route + "/claim", { claim, session })));
  assert.equal(attempts.filter(r => r.ok).length, 1);
  const winner = attempts.findIndex(r => r.ok);
  assert.equal((await attempts[winner].json()).body, body);
  const session = sessions[winner];
  const retry = await f.post(route + "/claim", { claim, session });
  assert.equal(retry.ok, true);
  assert.equal((await retry.json()).body, body);
  assert.equal((await f.post(route + "/end", { session: sessions[1 - winner] })).ok, false);
  assert.equal((await f.post(route + "/end", { session })).status, 204);
  assert.equal((await f.post(route + "/claim", { claim, session })).ok, false);
  assert.equal(f.secrex.db.prepare("SELECT 1 FROM secrex_payload WHERE id=?").get(id), undefined);
  const history = f.secrex.db.prepare("SELECT state, created_at, finished_at FROM secrex_history WHERE id=?").get(id);
  assert.equal(history.state, "destroyed");
  assert.ok(history.finished_at >= history.created_at);
});

test("Secrex rejects late claims, including sessions with a valid token", async (t) => {
  const f = await fixture(t);
  const { id, claim } = await f.create();
  const session = token(32);
  assert.equal((await f.post(`/${id}/claim`, { claim, session })).ok, true);
  f.advance(5 * 60 * 1000);
  assert.equal((await f.post(`/${id}/claim`, { claim, session })).ok, false);
  const pending = await f.create();
  f.advance(24 * 60 * 60 * 1000);
  await f.secrex.sweep();
  assert.notEqual(f.secrex.db.prepare("SELECT 1 FROM secrex_payload WHERE id=?").get(pending.id), undefined);
  f.advance(6 * 24 * 60 * 60 * 1000);
  await f.secrex.sweep();
  assert.equal((await f.post(`/${pending.id}/claim`, { claim: pending.claim, session })).ok, false);
});

test("browser crypto authenticates ciphertext, wrapped key and record context", async () => {
  const message = "Synthetic Secrex sample";
  const { id, password, payload } = await encryptSecret(message);
  assert.equal(await deriveClaim(id, password), payload.claim);
  assert.equal(await decryptSecret({ ...payload, password }), message);
  await assert.rejects(decryptSecret({ ...payload, password: token(32) }));
  await assert.rejects(decryptSecret({ ...payload, id: token(16), password }));
  await assert.rejects(decryptSecret({ ...payload, bodyNonce: token(12), password }));
  await assert.rejects(decryptSecret({ ...payload, wrapped: token(48), password }));
});
