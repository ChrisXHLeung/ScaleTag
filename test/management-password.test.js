import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PollStore, voterHash } from '../src/store.js';
import { SQLiteStore } from '../src/sqlite-store.js';
import { createTaskCredentials } from '../public/task-crypto.js';

for (const Store of [PollStore, SQLiteStore]) test(Store.name + ' stores only Argon2id verifiers for new management passwords and accepts legacy links', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'scaletag-password-'));
  const store = new Store(directory, { diskReserveBytes: 0 });
  await store.init();
  t.after(async () => {
    store.close?.();
    await rm(directory, { recursive: true, force: true });
  });
  const taskCredentials = await createTaskCredentials();
  const task = await store.create({
    type: 'task',
    title: 'Task',
    options: [],
    authKey: taskCredentials.authKey,
    contactPublicKey: taskCredentials.contactPublicKey,
    encryptedPrivateKey: taskCredentials.encryptedPrivateKey,
  });
  const giveaway = await store.create({ type: 'sale', giveawayVersion: 1, title: 'Chair', pickupLocation: 'Library', options: [] });
  const credential = (post) => post === task ? taskCredentials.authKey : (post.managePassword ?? post.manageKey);
  assert.ok(taskCredentials.password);
  assert.ok(credential(task));
  assert.ok(credential(giveaway));
  assert.notEqual(taskCredentials.password, credential(task));
  assert.notEqual(credential(task), credential(giveaway));
  for (const [post, manage] of [[task, 'manageTask'], [giveaway, 'manageSale']]) {
    const db = await store.read(post.id);
    const stored = JSON.stringify(db.data);
    const publicView = JSON.stringify(await store.get(post.id));
    assert.ok(stored.includes('$argon2id$v=19$'), 'new post stores an Argon2id verifier');
    assert.ok(!stored.includes(credential(post)), 'plaintext credential absent from storage');
    assert.ok(!stored.includes(taskCredentials.password), 'plaintext task password absent from storage');
    assert.ok(!publicView.includes('$argon2id$'));
    assert.ok(!publicView.includes(credential(post)));
    assert.ok(!publicView.includes(taskCredentials.password));
    assert.equal((await store[manage](post.id, credential(post))).id, post.id);
    await assert.rejects(store[manage](post.id, credential(post === task ? giveaway : task)), { status: 403 });
  }
  await assert.rejects(store.manageTask(task.id, taskCredentials.password), { status: 403 });
  const oldKey = 'a'.repeat(64);
  const db = await store.read(task.id);
  for (const key of Object.keys(db.data)) {
    if (typeof db.data[key] === 'string' && db.data[key].startsWith('$argon2id$')) delete db.data[key];
  }
  db.data.manageKeyHash = voterHash(oldKey);
  await store.write(db);
  assert.equal((await store.manageTask(task.id, oldKey)).id, task.id);
});
