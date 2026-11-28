import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
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
  function post(path, body, headers = {}) {
    return fetch(origin + "/api/secrex" + path, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }
  async function create(revoke) {
    const envelope = { id: token(16), claim: token(32), body: token(100),
      bodyNonce: token(12), wrapped: token(48), wrapNonce: token(12) };
    const verifier = revoke && createHash("sha256")
      .update(`scaletag:secrex:revoke:v1:${envelope.id}:${revoke}`)
      .digest("base64url");
    const response = await post("/", envelope, verifier ? { "X-Secrex-Revoke-Verifier": verifier } : {});
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      id: envelope.id,
      ...(verifier ? { revocable: true } : {}),
    });
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

test("short unopened lifetimes limit both the link and any reading session", async (t) => {
  const f = await fixture(t);
  const { id, payload } = await encryptSecret("Temporary test message");
  const expectedExpiry = f.secrex.clock() + 15 * 60000;
  for (const expiresInMinutes of [0, 14, "15", 15.5, null, 10081]) {
    assert.equal((await f.post("/", { ...payload, expiresInMinutes })).status, 400);
  }
  const created = await f.post("/", { ...payload, expiresInMinutes: 15 });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).expiresAt, expectedExpiry);
  assert.equal(JSON.parse(f.secrex.db.prepare("SELECT envelope FROM secrex_payload WHERE id=?").get(id).envelope).expiresInMinutes, undefined);
  f.advance(14 * 60000);
  const session = token(32);
  const claim = { claim: payload.claim, session };
  const opened = await f.post(`/${id}/claim`, claim);
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).expiresAt, expectedExpiry);
  f.advance(60000);
  assert.equal((await f.post(`/${id}/claim`, claim)).status, 404);
  assert.equal(f.secrex.db.prepare("SELECT 1 FROM secrex_payload WHERE id=?").get(id), undefined);

  const unopened = await encryptSecret("Unread test message");
  assert.equal((await f.post("/", { ...unopened.payload, expiresInMinutes: 15 })).status, 201);
  f.advance(15 * 60000);
  assert.equal((await f.post(`/${unopened.id}/claim`, { claim: unopened.payload.claim, session: token(32) })).status, 404);
});

test("only the independent sender code revokes an unopened Secrex", async (t) => {
  const f = await fixture(t);
  const revoke = token(32);
  const { id, claim } = await f.create(revoke);
  const route = `/${id}`;
  const wrongCredential = await f.post(route + "/revoke", { revoke: claim });
  assert.equal(wrongCredential.status, 404);
  assert.deepEqual(await wrongCredential.json(), { error: "This secret cannot be revoked or the code is incorrect." });
  assert.equal((await f.post(route + "/revoke", { revoke })).status, 204);
  assert.equal((await f.post(route + "/revoke", { revoke })).status, 404);
  assert.equal((await f.post(route + "/claim", { claim, session: token(32) })).status, 404);
  assert.equal(f.secrex.db.prepare("SELECT 1 FROM secrex_payload WHERE id=?").get(id), undefined);
  assert.equal(f.secrex.db.prepare("SELECT 1 FROM secrex_revocation WHERE id=?").get(id), undefined);
  assert.equal(f.secrex.db.prepare("SELECT state FROM secrex_history WHERE id=?").get(id).state, "revoked");
  assert.equal(f.secrex.createdCount(0, Number.MAX_SAFE_INTEGER), 1);
});

test("Secrex claim and revoke compete across database connections, and legacy shares still open", async (t) => {
  const f = await fixture(t);
  const other = new SecrexStore(f.secrex.directory, { clock: f.secrex.clock });
  await other.init();
  t.after(() => other.close());
  const revoke = token(32);
  const sample = await f.create(revoke);
  const attempts = await Promise.allSettled([
    f.secrex.claim(sample.id, sample.claim, token(32)),
    Promise.resolve().then(() => other.revoke(sample.id, revoke)),
  ]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);

  const reading = await f.create(revoke);
  await f.secrex.claim(reading.id, reading.claim, token(32));
  assert.equal((await f.post(`/${reading.id}/revoke`, { revoke })).status, 404);
  assert.equal(other.db.prepare("SELECT 1 FROM secrex_revocation WHERE id=?").get(reading.id), undefined);

  const legacy = await f.create();
  assert.equal((await f.post(`/${legacy.id}/revoke`, { revoke })).status, 404);
  assert.equal((await f.post(`/${legacy.id}/claim`, { claim: legacy.claim, session: token(32) })).status, 200);

  const expiring = await f.create(revoke);
  f.advance(7 * 24 * 60 * 60 * 1000);
  other.sweep();
  assert.equal((await f.post(`/${expiring.id}/revoke`, { revoke })).status, 404);
  assert.equal(other.db.prepare("SELECT 1 FROM secrex_revocation WHERE id=?").get(expiring.id), undefined);
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
