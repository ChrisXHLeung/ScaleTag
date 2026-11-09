import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/sqlite-store.js';
import { openDatabase } from '../src/database.js';

test('entire database is encrypted, shares transactions, and rejects missing/wrong keys', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'scaletag-encrypted-'));
 const previous = process.env.SCALETAG_ENCRYPTION_KEY;
 process.env.SCALETAG_ENCRYPTION_KEY = randomBytes(32).toString('hex');
 const a = new SQLiteStore(dir), b = new SQLiteStore(dir);
 t.after(async () => { a.close(); b.close(); if(previous === undefined) delete process.env.SCALETAG_ENCRYPTION_KEY; else process.env.SCALETAG_ENCRYPTION_KEY=previous; await rm(dir,{recursive:true,force:true}); });
 await a.init(); await b.init();
 const p = await a.create({title:'Sensitive database content',options:['A','B'],description:'',signature:'',images:[],location:{latitude:43,longitude:-79},mapVisible:true});
 await Promise.all(Array.from({length:10},(_,i)=>(i%2?a:b).vote(p.id,`v${i}`,1)));
 assert.equal((await b.get(p.id)).totalVotes,10);
 const file=join(dir,'scaletag.sqlite');
 const raw=await readFile(file);
 assert.ok(!raw.includes(Buffer.from('SQLite format 3')));
 assert.ok(!raw.includes(Buffer.from('Sensitive database content')));
 assert.throws(()=>openDatabase(file,{key:''}));
 assert.throws(()=>openDatabase(file,{key:randomBytes(32).toString('hex')}));
});


test('offline conversion and encrypted export/restore preserve records', async t => {
 const {execFileSync}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'scaletag-migrate-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'scaletag.sqlite');
 const db=openDatabase(file,{key:''});
 db.exec(`CREATE TABLE posts(id TEXT PRIMARY KEY,document TEXT NOT NULL,created_at INTEGER,ends_at INTEGER,delete_at INTEGER); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE rate_limits(key TEXT PRIMARY KEY,start INTEGER,count INTEGER);`);
 db.prepare('INSERT INTO posts VALUES(?,?,?,?,?)').run('a'.repeat(24),JSON.stringify({id:'a'.repeat(24),type:'sale',title:'Migration secret',images:['data:image/jpeg;base64,cHJpdmF0ZS1pbWFnZS1ieXRlcw=='],replies:[{name:'Buyer',amount:'CAD 40',email:'private@example.com'}]}),1,2,3);db.close();
 const env={...process.env,DATA_DIR:dir,SCALETAG_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
 const run=(script,args=[],input)=>execFileSync(process.execPath,[script,...args],{env,input,encoding:'utf8'});
 const initial=run('src/encrypted-backup.js',['--plaintext-source']);
 assert.ok(!initial.includes('Migration secret'));
 run('src/encrypted-backup.js',['--verify'],initial);
 run('src/encrypt-database.js');
 run('src/encrypt-database.js');
 assert.ok(!(await readFile(file)).includes(Buffer.from('Migration secret')));
 const encrypted=run('src/encrypted-backup.js');
 run('src/encrypted-backup.js',['--verify'],encrypted);
 const target=join(dir,'restored.sqlite');
 run('src/restore-encrypted-backup.js',[target],encrypted);
 const restored=openDatabase(target,{key:env.SCALETAG_ENCRYPTION_KEY});
 const document=JSON.parse(restored.prepare('SELECT document FROM posts').get().document);
 assert.equal(document.title,'Migration secret');
 assert.deepEqual(document.images,['data:image/jpeg;base64,cHJpdmF0ZS1pbWFnZS1ieXRlcw==']);
 assert.equal(document.replies[0].email,'private@example.com');
 assert.ok(!encrypted.includes('private@example.com'));
 assert.ok(!encrypted.includes('cHJpdmF0ZS1pbWFnZS1ieXRlcw=='));
 restored.close();
});
