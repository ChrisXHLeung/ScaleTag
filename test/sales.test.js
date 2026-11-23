import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';
import { PollStore, DAY } from '../src/store.js';
import { SQLiteStore } from '../src/sqlite-store.js';
import { createApp } from '../src/app.js';
const origin='https://scaletag.test';
for (const Store of [PollStore, SQLiteStore]) test(`${Store.name}: free giveaway lifecycle`, async t => {
 const dir=await mkdtemp(join(tmpdir(),'giveaway-')); let now=1000000000000;
 const store=new Store(dir,{clock:()=>now,diskReserveBytes:0}); await store.init();
 const server=createApp(store,{origin}).listen(0,'127.0.0.1'); await once(server,'listening');
 t.after(async()=>{await new Promise(r=>server.close(r));store.close?.();await rm(dir,{recursive:true,force:true});});
 const req=(path,body,cookie)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const legacy=await store.create({type:'sale',title:'Old listing',description:'old',price:'CAD 50',options:[],images:[],signature:'Anonymous',location:{latitude:43,longitude:-79},mapVisible:true});
 const poll=await store.create({type:'poll',title:'Keep poll',options:['Yes','No'],signature:'Anonymous',location:{latitude:43,longitude:-79},mapVisible:true});
 assert.equal((await req(`/api/sales/${legacy.id}`)).status,404);
 assert.equal((await req(`/api/posts/${legacy.id}/social`)).status,404);
 await store.sweep(); assert.equal((await store.read(legacy.id)).data, null, 'legacy sale is removed'); assert.ok((await store.read(poll.id)).data, 'poll remains');
 assert.equal((await store.list({type:'sale'})).polls.length,0);
 assert.equal((await store.map({type:'sale'})).polls.length,0);
 const png=await sharp({create:{width:20,height:20,channels:3,background:'#123456'}}).png().toBuffer();
 const image=`data:image/png;base64,${png.toString('base64')}`;
 const input={title:'Chair',description:'Good condition',pickupLocation:'North library entrance',images:[image],location:{latitude:43,longitude:-79},mapVisible:true,retentionAccepted:true};
 assert.equal((await req('/api/sales',{...input,pickupLocation:''})).status,400);
 const created=await req('/api/sales',input); assert.equal(created.status,201); const post=await created.json();
 assert.match(post.images[0],/^data:image\/jpeg;base64,/);
 assert.equal((await req(`/api/sales/${post.id}/qr.png`)).status,200);
 assert.equal(post.endsAt-now,3*DAY); assert.equal(post.deleteAt-now,30*DAY); assert.equal(post.pickupLocation,input.pickupLocation); assert.equal(post.price,undefined);
 const social=await req(`/api/posts/${post.id}/social`);const cookie=social.headers.get('set-cookie').split(';')[0];
 const likes=await Promise.all(Array.from({length:5},()=>req(`/api/posts/${post.id}/likes`,{},cookie)));
 assert.ok(likes.every(x=>x.status===200));
 assert.equal((await (await req(`/api/posts/${post.id}/social`,undefined,cookie)).json()).totalLikes,1);
 assert.notEqual((await req(`/api/posts/${post.id}/offers`,{amount:'1',email:'buyer@example.com',message:'hello',privacyAccepted:true,nonBindingAccepted:true},cookie)).status,201);
 assert.equal((await req(`/api/sales/${post.id}/state`,{key:'a'.repeat(64),state:'closed'})).status,403);
 assert.equal((await req(`/api/sales/${post.id}/state`,{key:post.manageKey,state:'closed'})).status,200);
 for (const path of [`/api/sales/${post.id}`,`/sale/${post.id}`,`/api/sales/${post.id}/qr.png`,`/api/posts/${post.id}/social`]) assert.equal((await req(path)).status,404,path);
 for (const [path,body] of [['/api/posts/search',{type:'sale'}],['/api/map/search',{type:'sale'}]]) assert.equal((await (await req(path,body)).json()).polls.length,0);
 const claimed = await (await req('/api/sales', input)).json();
 const statePath = `/api/sales/${claimed.id}/state`;
 assert.equal((await req(statePath, { key: 'a'.repeat(64), state: 'claimed' })).status, 403);
 const claims = await Promise.all(Array.from({ length: 2 }, () =>
   req(statePath, { key: claimed.manageKey, state: 'claimed' })));
 assert.ok(claims.every(response => response.status === 200));
 assert.equal((await req(statePath, { key: claimed.manageKey, state: 'closed' })).status, 409);
 const details = await req(`/api/sales/${claimed.id}`);
 assert.equal(details.status, 200);
 assert.match(details.headers.get('cache-control'), /no-store/);
 const claimedDetails = await details.json();
 assert.equal(claimedDetails.saleState, 'claimed');
 assert.equal(claimedDetails.endsAt, claimed.endsAt);
 assert.equal(claimedDetails.title, input.title);
 assert.equal(Object.hasOwn(claimedDetails, 'pickupLocation'), false);
 for (const path of [`/sale/${claimed.id}`, `/api/sales/${claimed.id}/qr.png`]) {
   const response = await req(path);
   assert.equal(response.status, 200, path);
   assert.ok(!(await response.text()).includes(input.pickupLocation));
 }
 assert.equal(await store.count(), 1, 'only the poll remains discoverable');
 for (const path of ['/api/posts/search', '/api/map/search']) {
   const results = await (await req(path, { type: 'sale' })).json();
   assert.equal(results.polls.length, 0, path);
 }
 const again = await (await req('/api/sales', input)).json();
 now += 3 * DAY - 1;
 assert.equal((await req(`/api/sales/${again.id}`)).status, 200);
 assert.equal((await req(`/sale/${claimed.id}`)).status, 200);
 now++;
 for (const id of [again.id, claimed.id]) {
   for (const path of [`/api/sales/${id}`, `/api/sales/${id}/qr.png`, `/sale/${id}`]) {
     assert.equal((await req(path)).status, 404, path);
   }
 }
 for (const path of ['/api/posts/search', '/api/map/search']) {
   assert.equal((await (await req(path, { type: 'sale' })).json()).polls.length, 0);
 }
 await store.sweep();
 assert.ok((await store.read(again.id)).data, 'expired giveaway stays stored');
 assert.ok((await store.read(claimed.id)).data, 'claimed giveaway stays stored');
 assert.equal((await store.read(legacy.id)).data, null, 'legacy sale removed');
 now += 27 * DAY;
 await store.sweep();
 for (const id of [again.id, claimed.id]) {
   assert.equal((await store.read(id)).data, null, 'new giveaway is removed after 30 days');
 }
});
for (const Store of [PollStore,SQLiteStore]) test(`${Store.name}: restart removes legacy and expired giveaways`, async t => {
 const dir=await mkdtemp(join(tmpdir(),'giveaway-restart-')); let now=1000000000000;
 const store=new Store(dir,{clock:()=>now,diskReserveBytes:0}); await store.init();
 const common={type:'sale',title:'Chair',description:'Good',options:[],images:[],signature:'Anonymous',location:{latitude:43,longitude:-79},mapVisible:true};
 const legacy=await store.create({...common,price:'CAD 10'}), fresh=await store.create({...common,pickupLocation:'Library',giveawayVersion:1});
 store.close?.(); now+=31*DAY;
 const reopened=new Store(dir,{clock:()=>now,diskReserveBytes:0}); await reopened.init(); await reopened.sweep();
 assert.equal((await reopened.read(legacy.id)).data,null,'legacy record removed after restart and sweep');
 assert.equal((await reopened.read(fresh.id)).data,null,'new giveaway cleaned after 30 days');
 reopened.close?.(); await rm(dir,{recursive:true,force:true});
});

for (const Store of [PollStore, SQLiteStore]) {
  for (const lifecycle of ['closed', 'expired']) {
    test(`${Store.name}: ${lifecycle} giveaways occupy capacity until swept`, async (t) => {
      const dir = await mkdtemp(join(tmpdir(), 'giveaway-capacity-'));
      const createdAt = 1000000000000;
      let now = createdAt;
      const store = new Store(dir, {
        clock: () => now,
        diskReserveBytes: 0,
        maxPolls: 2,
      });
      t.after(async () => {
        store.close?.();
        await rm(dir, { recursive: true, force: true });
      });
      await store.init();

      const sale = { type: 'sale', title: 'Chair', options: [] };
      const legacy = await store.create({ ...sale, price: 'CAD 10' });
      const giveaway = { ...sale, pickupLocation: 'Library', giveawayVersion: 1 };
      const post = await store.create(giveaway);
      assert.equal(await store.count(), 1);

      if (lifecycle === 'closed') await store.closeSale(post.id, post.manageKey);
      else now += 3 * DAY;
      assert.equal(await store.count(), 0);
      await assert.rejects(store.create(giveaway), { status: 503 });

      now = createdAt + 30 * DAY;
      await assert.rejects(store.create(giveaway), { status: 503 });
      await store.sweep();
      assert.equal((await store.read(post.id)).data, null);
      assert.equal((await store.read(legacy.id)).data, null);
      await store.create(giveaway);
      assert.equal(await store.count(), 1);
      await store.create(giveaway);
      await assert.rejects(store.create(giveaway), { status: 503 });
    });
  }
}
