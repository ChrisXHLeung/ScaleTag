import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { PollStore, DAY } from '../src/store.js';
import { SQLiteStore } from '../src/sqlite-store.js';
import { createApp } from '../src/app.js';
import { createTaskCredentials } from '../public/task-crypto.js';

for (const Store of [PollStore, SQLiteStore]) for (const kind of ['poll', 'task']) {
  test(`${Store.name}: ${kind} uploads, bounds, privacy and photo expiry`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'post-photo-')); let now = Date.now();
    const store = new Store(dir, {clock: () => now, diskReserveBytes: 0}); await store.init();
    const origin = 'https://scaletag.test';
    const server = createApp(store, {origin, createLimit:1000}).listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => {server.closeAllConnections(); await new Promise(r => server.close(r)); store.close?.(); await rm(dir, {recursive:true, force:true});});
    const request = (path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {method:body===undefined?'GET':'POST', headers:{origin, 'content-type':'application/json'}, ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const original = await sharp(randomBytes(500*500*3), {raw:{width:500,height:500,channels:3}}).withMetadata({exif:{IFD0:{Artist:'Private author'}}}).png().toBuffer();
    assert.ok(original.length>614400 && original.length<=1048576);
    const photo = `data:image/png;base64,${original.toString('base64')}`;
    const input = {title:'Photo post',description:'A public description',signature:'Neighbour',options:['Yes','No'],reward:'Coffee',images:[photo,photo,photo],location:{latitude:43.651234,longitude:-79.381234},mapVisible:true,retentionAccepted:true};
    if (kind === 'task') Object.assign(input, await createTaskCredentials().then(({authKey, contactPublicKey, encryptedPrivateKey}) => ({authKey, contactPublicKey, encryptedPrivateKey})));
    const endpoint = `/api/${kind}s`;
    const published = await request(endpoint,input); assert.equal(published.status,201, await published.clone().text());
    const post = await published.json(); assert.equal(post.images.length,3); assert.equal(post.deleteAt-now,30*DAY);
    for (const image of post.images) {
      assert.match(image,/^data:image\/jpeg;base64,/); const bytes=Buffer.from(image.split(',')[1],'base64');
      assert.ok(bytes.length<=307200); const metadata=await sharp(bytes).metadata(); assert.equal(metadata.exif,undefined); assert.equal(metadata.icc,undefined);
    }
    const detail=await(await request(`${endpoint}/${post.id}`)).json(); assert.deepEqual(detail.images,post.images);
    assert.equal(detail.location,undefined); assert.equal(detail.manageKey,undefined); assert.equal(detail.manageKeyHash,undefined);
    for (const [path,body] of [['/api/posts'],['/api/posts/search',{type:kind}],['/api/map/search',{type:kind}], [`/api/posts/${post.id}/social`]]) {
      const response=await request(path,body); assert.equal(response.status,200); const raw=await response.text(); assert.ok(!raw.includes('data:image/')); assert.ok(!raw.includes('Private author')); assert.ok(!raw.includes('manageKeyHash'));
    }
    for (const images of [[photo,photo,photo,photo],['data:image/png;base64,YmFk'],['data:image/svg+xml;base64,PHN2Zy8+'],['data:image/png;base64,'+Buffer.alloc(1048577).toString('base64')]]) {
      assert.equal((await request(endpoint,{...input,images})).status,400);
    }
    assert.equal((await request(endpoint,{...input,title:'x'.repeat(141)})).status,400);
    assert.equal((await request(endpoint,{...input,description:'x'.repeat(25000),images:[]})).status,400);
    assert.equal((await request(endpoint,{...input,images:['x'.repeat(4300000)]})).status,413);
    assert.equal((await request(`/api/posts/${post.id}/likes`,{padding:'x'.repeat(25000)})).status,413);
    assert.equal((await request('/api/posts/search',{padding:'x'.repeat(25000)})).status,413);
    const legacy=await request(endpoint,{...input,images:['https://example.com/old.png']}); assert.equal(legacy.status,201); assert.deepEqual((await legacy.json()).images,['https://example.com/old.png']);
    now+=30*DAY; assert.equal((await request(`${endpoint}/${post.id}`)).status,404);
    await store.sweep(); assert.equal(await store.count(),0);
  });
}
