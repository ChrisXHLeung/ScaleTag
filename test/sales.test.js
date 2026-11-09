import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { PollStore, DAY } from '../src/store.js';
import { SQLiteStore } from '../src/sqlite-store.js';
import { createApp } from '../src/app.js';
const origin='https://scaletag.test';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6WQAAAAASUVORK5CYII=';
for(const Store of [PollStore,SQLiteStore]) test(`${Store.name}: sale offers stay private, close and expire with images`, async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sale-')); let now=1000000000000;
 const store=new Store(dir,{clock:()=>now,diskReserveBytes:0}); await store.init();
 const server=createApp(store,{origin}).listen(0,'127.0.0.1'); await once(server,'listening');
 t.after(async()=>{await new Promise(r=>server.close(r));store.close?.();await rm(dir,{recursive:true,force:true});});
 const request=(path,body,cookie)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const input={title:'Chair <script>',description:'A chair',price:'CAD 50',images:[image],location:{latitude:43,longitude:-79},mapVisible:true,retentionAccepted:true};
 const response=await request('/api/sales',input);assert.equal(response.status,201);const sale=await response.json();
 assert.equal(sale.endsAt-now,30*DAY);assert.match(sale.manageKey,/^[a-f0-9]{64}$/); assert.match(sale.images[0],/^data:image\/jpeg;base64,/);
 assert.equal((await store.list({type:'sale'})).polls[0].images,undefined);
 assert.equal((await store.map({type:'sale'})).polls[0].type,'sale');
 if(Store===SQLiteStore){ const other=new SQLiteStore(dir,{clock:()=>now,diskReserveBytes:0}); await other.init(); try { assert.equal((await other.get(sale.id)).images[0],sale.images[0]); assert.equal((await other.list({type:'sale'})).polls[0].id,sale.id); } finally {other.close();} }
 assert.equal((await request(`/api/sales/${sale.id}/qr.png`)).status,200);
 assert.equal((await request('/api/polls',{...input,options:['A','B'],signature:'Neighbour',description:'x'.repeat(25000)})).status,400);
 assert.equal((await request('/api/sales',{...input,images:['x'.repeat(4300000)]})).status,413);
 const social=await request(`/api/posts/${sale.id}/social`);const cookie=social.headers.get('set-cookie').split(';')[0];
 const offer={name:'Buyer',message:'Interested',amount:'CAD 40',email:'buyer@example.com',phone:'+1 416 555 1234',privacyAccepted:true,nonBindingAccepted:true};
 assert.equal((await request(`/api/posts/${sale.id}/offers`,{...offer,nonBindingAccepted:false},cookie)).status,400);
 assert.equal((await request(`/api/posts/${sale.id}/offers`,{...offer,amount:'buyer@example.com'},cookie)).status,400);
 for(const override of [{amount:'555-1234'},{name:'416/555/1234'},{message:'Call 555-1234'}]) assert.equal((await request(`/api/posts/${sale.id}/offers`,{...offer,...override},cookie)).status,400);
 const offered=await request(`/api/posts/${sale.id}/offers`,offer,cookie);assert.equal(offered.status,201);let publicData=await offered.json();assert.equal(publicData.replies[0].amount,'CAD 40');assert.equal(publicData.replies[0].email,undefined);
 const noSecrets=(value)=>{
   const raw=JSON.stringify(value);
   for(const secret of ['buyer@example.com','+1 416 555 1234',sale.manageKey,'manageKeyHash','replyAuthors','likers']) assert.ok(!raw.includes(secret),secret);
   const inspect=v=>{if(v&&typeof v==='object')for(const [key,child] of Object.entries(v)){assert.ok(!['phone','email','manageKey'].includes(key),key);inspect(child);}};inspect(value);
 };
 noSecrets(publicData);
 for(const [path,body] of [[`/api/sales/${sale.id}`],[`/api/posts/${sale.id}/social`],['/api/posts'],['/api/posts/search',{type:'sale'}],['/api/map/search',{type:'sale'}]]) {const r=await request(path,body);assert.equal(r.status,200);noSecrets(await r.json());}
 for(const body of [{},{key:'a'.repeat(64)}]){const r=await request(`/api/sales/${sale.id}/manage`,body);assert.equal(r.status,403);noSecrets(await r.json());}
 const managed=await request(`/api/sales/${sale.id}/manage`,{key:sale.manageKey});assert.equal((await managed.json()).replies[0].email,'buyer@example.com');
 assert.equal((await request(`/api/sales/${sale.id}/state`,{key:sale.manageKey,state:'sold'})).status,400);
 assert.equal((await request(`/api/sales/${sale.id}/state`,{key:sale.manageKey,state:'closed'})).status,200);
 assert.equal((await request(`/api/posts/${sale.id}/offers`,offer,cookie)).status,409);
 assert.equal((await (await request(`/api/posts/${sale.id}/social`)).json()).saleState,'closed');
 assert.equal((await request(`/api/polls/${sale.id}`)).status,404);
 for(const images of [[image,image,image,image],['data:image/svg+xml;base64,PHN2Zy8+'],['data:image/png;base64,YmFk'],['data:image/png;base64,'+Buffer.alloc(1048577).toString('base64')]]) assert.equal((await request('/api/sales',{...input,images})).status,400);
 now+=30*DAY;assert.equal((await request(`/api/sales/${sale.id}`)).status,404);assert.equal((await request(`/api/sales/${sale.id}/qr.png`)).status,404);assert.equal((await request(`/api/sales/${sale.id}/manage`,{key:sale.manageKey})).status,404);for(const [path,body] of [[`/api/posts/${sale.id}/social`],[`/api/posts/${sale.id}/offers`,offer],[`/api/sales/${sale.id}/state`,{key:sale.manageKey,state:'closed'}]]){const r=await request(path,body,cookie);assert.equal(r.status,404);noSecrets(await r.json());}
 assert.equal((await request(`/sale/${sale.id}`)).status,404);
 for(const [path,body] of [['/api/posts/search',{type:'sale'}],['/api/map/search',{type:'sale'}]]){const data=await(await request(path,body)).json();assert.deepEqual(data.polls,[]);noSecrets(data);}
 await store.sweep(); assert.equal(await store.count(),0);
});
