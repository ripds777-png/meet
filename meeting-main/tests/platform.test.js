import test,{before,after,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {allowed,completion,documents,createDossier,hash,session} from '../server/platform.js';
import {ingest} from '../dossier.js';
import endpoint from '../api/platform.js';
import ai from '../api/openai.js';
import deepgram from '../api/deepgram-token.js';
let db;const admin='10000000-0000-4000-8000-000000000001',advisor='10000000-0000-4000-8000-000000000002',manager='10000000-0000-4000-8000-000000000003',outsider='10000000-0000-4000-8000-000000000004';let first,second;
before(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);for(const f of (await readdir(new URL('../migrations/',import.meta.url))).sort())await db.exec(await readFile(new URL('../migrations/'+f,import.meta.url),'utf8'));});
after(async()=>db.close());
beforeEach(async()=>{process.env.SUPABASE_URL='https://database.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';process.env.APP_ORIGIN='https://app.test';await db.exec('truncate meet_profiles,auth.users,meet_clients cascade');for(const id of [admin,advisor,manager,outsider])await db.query('insert into auth.users values($1)',[id]);
 await db.query(`insert into meet_profiles(id,name,email,roles,societies,can_create,must_change_password)values($1,'Admin','admin@test.invalid',array['admin'],array['PWM'],false,false),($2,'Advisor','advisor@test.invalid',array['advisor'],array['PWM'],true,false),($3,'Manager','manager@test.invalid',array['responsable'],array['PWM'],true,false),($4,'Other','other@test.invalid',array['advisor'],array['ADM'],true,false)`,[admin,advisor,manager,outsider]);
 first=(await db.query('select meet_create_dossier($1,null,$2,$3,$4) as d',[advisor,'Même nom','PWM',createDossier('Même nom')])).rows[0].d;second=(await db.query('select meet_create_dossier($1,null,$2,$3,$4) as d',[outsider,'Même nom','ADM',createDossier('Même nom')])).rows[0].d;
 await db.query('insert into meet_grants values($1,$2,$3)',[first.id,manager,['read','write','assign','review']]);
 const token='a'.repeat(64);await db.query(`insert into meet_sessions(token_hash,user_id,session_version,expires_at)values($1,$2,1,now()+interval '1 hour')`,[await hash(token),advisor]);
 mock.method(globalThis,'fetch',rest);
});
afterEach(()=>mock.restoreAll());
function response(x,status=200){return new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});}
async function rest(url,options={}){const u=new URL(url);if(u.pathname.startsWith('/rest/v1/rpc/')){const fn=u.pathname.split('/').at(-1);assert.match(fn,/^meet_[a-z_]+$/);const b=JSON.parse(options.body);try{const result=await db.query('select '+fn+'('+Object.keys(b).map((k,i)=>k+'=> $'+(i+1)).join(',')+') as value',Object.values(b));return response(result.rows[0].value);}catch(e){return response({code:e.code},400);}}
 const table=u.pathname.split('/').at(-1);assert.match(table,/^meet_[a-z_]+$/);let params=[],where=[];for(const [k,v]of u.searchParams){if(['order','limit','select','on_conflict'].includes(k))continue;assert.match(k,/^[a-z_]+$/);if(v.startsWith('eq.')){params.push(v.slice(3));where.push(k+'=$'+params.length);}else if(v.startsWith('gt.')){params.push(v.slice(3));where.push(k+'>$'+params.length);}else throw new Error('Unsupported test filter '+v);}
 const predicate=where.length?' where '+where.join(' and '):'';const method=options.method||'GET';if(method==='GET')return response((await db.query('select * from '+table+predicate,params)).rows);
 if(method==='POST'){const b=JSON.parse(options.body);const keys=Object.keys(b);const result=await db.query('insert into '+table+'('+keys.join(',')+')values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')returning *',Object.values(b));return response(result.rows);}
 throw new Error('Unexpected operation '+method);
}
const req=(action,body,withCookie=true)=>new Request('https://app.test/api/platform?action='+action,{method:body?'POST':'GET',headers:{origin:'https://app.test',...(withCookie?{cookie:'__Host-meet='+'a'.repeat(64)}:{}),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
test('schema: private bucket, RLS, no direct anonymous data or definer access',async()=>{assert.equal((await db.query(`select public from storage.buckets where id='meet-private'`)).rows[0].public,false);await db.exec('set role anon');await assert.rejects(db.query('select * from meet_dossiers'),/permission denied/);await assert.rejects(db.query("select meet_login_gate('x')"),/permission denied/);await db.exec('reset role');});
test('individual session ignores shared password and browser supplied role',async()=>{assert.equal((await endpoint(req('admin-users'))).status,403);assert.equal((await endpoint(req('me',undefined,false))).status,401);const r=await ai(new Request('https://app.test/api/openai',{method:'POST',headers:{origin:'https://app.test','x-app-password':'anything','content-type':'application/json'},body:JSON.stringify({mode:'ping',role:'admin'})}));assert.equal(r.status,401);});
test('disabled accounts and version changes revoke open sessions immediately',async()=>{assert.equal((await endpoint(req('me'))).status,200);await db.query('update meet_profiles set session_version=2 where id=$1',[advisor]);assert.equal((await endpoint(req('me'))).status,401);await db.query('update meet_profiles set session_version=1,active=false where id=$1',[advisor]);assert.equal((await endpoint(req('me'))).status,401);});
test('direct requests and Deepgram reject another client and company',async()=>{assert.equal((await endpoint(req('command',{dossierId:second.id,revision:1,command:'stage',stage:'documents'}))).status,403);assert.equal((await deepgram(req('token',{dossierId:second.id}))).status,403);});
test('cross site mutations fail before provider or database access',async()=>{const r=await endpoint(new Request('https://app.test/api/platform?action=create',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'}));assert.equal(r.status,403);assert.equal(fetch.mock.callCount(),0);});
test('same names never merge clients; each project owns its data',async()=>{assert.notEqual(first.client_id,second.client_id);assert.notEqual(first.id,second.id);const third=(await db.query('select meet_create_dossier($1,$2,$3,$4,$5) as d',[advisor,first.client_id,'Second projet','PWM',createDossier('Second projet')])).rows[0].d;assert.equal(third.client_id,first.client_id);assert.notEqual(third.id,first.id);});
test('optimistic save prevents stale jobs or editors from overwriting corrected facts',async()=>{const data=first.data;const args=[first.id,1,data,advisor,'test',documents(data),{}];await db.query('select meet_save_dossier($1,$2,$3,$4,$5,$6,$7)',args);await assert.rejects(db.query('select meet_save_dossier($1,$2,$3,$4,$5,$6,$7)',args),/revision conflict/);});
test('partial drafts are saved and unchanged renders do not duplicate versions',async()=>{const data=first.data;let d=(await db.query('select meet_save_dossier($1,1,$2,$3,$4,$5,$6) as d',[first.id,data,advisor,'test',documents(data),{}])).rows[0].d;const count=(await db.query('select count(*) n from meet_documents where dossier_id=$1',[first.id])).rows[0].n;await db.query('select meet_save_dossier($1,$2,$3,$4,$5,$6,$7)',[d.id,d.revision,data,advisor,'retry',documents(data),{}]);assert.equal((await db.query('select count(*) n from meet_documents where dossier_id=$1',[d.id])).rows[0].n,count);});
test('completion is deterministic and distinct from review, future fields and evidence',()=>{const d=createDossier('A');d.targets=['A06'];for(const id of ['F10','F11']){const source={id:crypto.randomUUID(),text:'Exemple SAS : 100 EUR',role:'client'};ingest(d,{facts:[{fieldId:id,sourceId:source.id,quote:source.text,raw:'100 EUR',entity:'Exemple SAS',currency:'EUR'}]},[source]);}const c=completion(d,'A06');assert.equal(c.status,'Complet');assert.equal(c.review,'À relire');assert.equal(d.evidence.length,0);d.facts.push({...d.facts[0],id:crypto.randomUUID(),raw:'200 EUR'});assert.equal(completion(d,'A06').status,'Partiel');});
test('admin cannot elevate self; last administrator cannot be removed',async()=>{await assert.rejects(db.query('select meet_change_profile($1,$1,$2,$3,true,true)',[admin,['admin','advisor'],['PWM']]),/insufficient/);await assert.rejects(db.query('select meet_change_profile($1,$2,$3,$4,false,false)',[manager,admin,[],[]]),/insufficient/);});
test('stable segment delivery is idempotent and enqueues durable extraction atomically',async()=>{const call=crypto.randomUUID(),s={id:crypto.randomUUID(),position_ms:123,text:'Projet fictif',role:'client',speaker:'1'};await db.query('insert into meet_calls(id,dossier_id,advisor_id,config)values($1,$2,$3,$4)',[call,first.id,advisor,{}]);for(let i=0;i<2;i++)await db.query('select meet_append_segments($1,$2,$3)',[advisor,call,[s]]);assert.equal((await db.query('select count(*) n from meet_segments')).rows[0].n,1);assert.equal((await db.query('select count(*) n from meet_jobs')).rows[0].n,1);const job=(await db.query('select meet_claim_job() j')).rows[0].j;assert.equal(job.status,'running');assert.equal(job.batch.length,1);});
test('file receipt never succeeds with missing bytes',async()=>{const id=crypto.randomUUID();await db.query('insert into meet_files(id,dossier_id,filename,mime,kind,parts,bytes,created_by)values($1,$2,$3,$4,$5,2,100,$6)',[id,first.id,'test.txt','text/plain','evidence',advisor]);await assert.rejects(db.query('select meet_complete_file($1,$2)',[advisor,id]),/incomplete/);assert.equal((await db.query('select receipt from meet_files where id=$1',[id])).rows[0].receipt,'uploading');});


test('protected pages reject direct role and dossier URLs after refresh',async()=>{
 await import('../scripts/build.mjs');const {default:page}=await import('../api/page.js');
 assert.equal((await page(new Request('https://app.test/api/page?space=responsable',{headers:{cookie:'__Host-meet='+'a'.repeat(64)}}))).status,403);
 assert.equal((await page(new Request('https://app.test/api/page?space=advisor'))).headers.get('location'),'/login');
 assert.equal((await page(new Request('https://app.test/api/page?space=advisor&dossier='+second.id,{headers:{cookie:'__Host-meet='+'a'.repeat(64)}}))).status,403);
 const ok=await page(new Request('https://app.test/api/page?space=advisor&dossier='+first.id,{headers:{cookie:'__Host-meet='+'a'.repeat(64)}}));assert.equal(ok.status,200);assert.match(await ok.text(),/MEET_PROFILE/);assert.equal(ok.headers.get('cache-control'),'private, no-store');
});

test('explicit PWM to Admiralty pack does not grant unrelated source access',async()=>{
 await db.query('update meet_profiles set societies=$1 where id=$2',[['PWM','ADM'],manager]);await db.query('update meet_grants set permissions=$1 where dossier_id=$2 and user_id=$3',[['read','write','transfer'],first.id,manager]);await db.query('insert into meet_grants values($1,$2,$3)',[second.id,manager,['read','write']]);
 const result=await db.query('select meet_transfer($1,$2,1,$3,1,$4,$5,$6,$7) as d',[manager,first.id,second.id,second.data,documents(second.data),[],{reason:'Pack explicite'}]);assert.equal(result.rows[0].d.society,'ADM');assert.equal((await db.query('select count(*) n from meet_grants where dossier_id=$1 and user_id=$2',[first.id,outsider])).rows[0].n,0);assert.equal((await db.query("select count(*) n from meet_audit where event in('transfer.received','transfer.sent')")).rows[0].n,2);
});

test('validated version is kept when a changed fact produces a new working version',async()=>{
 const d=first.data;await db.query('select meet_save_dossier($1,1,$2,$3,$4,$5,$6)',[first.id,d,advisor,'initial',documents(d),{}]);await db.query("update meet_documents set review='Validé par une personne habilitée' where dossier_id=$1",[first.id]);const original=(await db.query('select content from meet_documents where dossier_id=$1 limit 1',[first.id])).rows[0].content;
 const source={id:crypto.randomUUID(),text:'Notre société est Exemple SAS.',role:'client'};ingest(d,{facts:[{fieldId:'F01',sourceId:source.id,quote:source.text,raw:'Exemple SAS'}]},[source]);await db.query('select meet_save_dossier($1,2,$2,$3,$4,$5,$6)',[first.id,d,advisor,'fact',documents(d),{}]);assert.ok((await db.query("select * from meet_documents where dossier_id=$1 and review='Validé par une personne habilitée' and content=$2",[first.id,original])).rows.length);assert.ok((await db.query("select * from meet_documents where dossier_id=$1 and review='À relire' and version=2",[first.id])).rows.length);
});

test('same uploaded file completion is idempotent and job remains durable',async()=>{
 const f=crypto.randomUUID();await db.query('insert into meet_files(id,dossier_id,filename,mime,kind,parts,bytes,created_by)values($1,$2,$3,$4,$5,1,3,$6)',[f,first.id,'file.txt','text/plain','evidence',advisor]);await db.query('insert into meet_file_parts values($1,0,$2,$3,3)',[f,'private/'+f,'hash']);for(let i=0;i<2;i++)await db.query('select meet_complete_file($1,$2)',[advisor,f]);assert.equal((await db.query('select count(*) n from meet_jobs')).rows[0].n,1);assert.equal((await db.query('select receipt from meet_files where id=$1',[f])).rows[0].receipt,'received');
});

test('late stable segment requests a fresh summary once after a call ends',async()=>{
 const call=crypto.randomUUID(),s={id:crypto.randomUUID(),position_ms:1500,text:'Dernière précision',role:'client',speaker:'1'};
 await db.query('insert into meet_calls(id,dossier_id,advisor_id,config)values($1,$2,$3,$4)',[call,first.id,advisor,{}]);
 await db.query('select meet_finish_call($1,$2,2000,false)',[advisor,call]);
 await db.query("update meet_jobs set status='done'");
 for(let i=0;i<2;i++)await db.query('select meet_append_segments($1,$2,$3)',[advisor,call,[s]]);
 assert.equal((await db.query("select count(*) n from meet_jobs where kind='summary' and status='pending'")).rows[0].n,1);
 assert.equal((await db.query("select count(*) n from meet_jobs where kind='extract'")).rows[0].n,1);
});

test('extraction batches fit the model input limit without discarding remaining segments',async()=>{
 const call=crypto.randomUUID();await db.query('insert into meet_calls(id,dossier_id,advisor_id,config)values($1,$2,$3,$4)',[call,first.id,advisor,{}]);
 const segments=Array.from({length:12},()=>({id:crypto.randomUUID(),position_ms:0,text:'x'.repeat(8000),role:'client',speaker:'1'}));
 await db.query('select meet_append_segments($1,$2,$3)',[advisor,call,segments]);
 const job=(await db.query('select meet_claim_job() j')).rows[0].j;
 assert.equal(job.batch.length,3);assert.ok(job.batch.some(j=>j.id===job.id));
 assert.equal((await db.query("select count(*) n from meet_jobs where status='pending'")).rows[0].n,9);
});

test('admin-only account cannot read an old dossier assignment through APIs',async()=>{
 await db.query("update meet_profiles set roles=array['admin'] where id=$1",[advisor]);
 assert.equal((await endpoint(req('list'))).status,403);
 assert.equal((await endpoint(new Request('https://app.test/api/platform?action=detail&dossierId='+first.id,{headers:{cookie:'__Host-meet='+'a'.repeat(64)}}))).status,403);
});

test('document review rejects stale facts and requires the explicit approval grant',async()=>{
 await db.query('select meet_save_dossier($1,1,$2,$3,$4,$5,$6)',[first.id,first.data,advisor,'initial',documents(first.data),{}]);
 const doc=(await db.query('select id from meet_documents where dossier_id=$1 limit 1',[first.id])).rows[0];
 await assert.rejects(db.query('select meet_review_document($1,$2,1,$3,$4,$5)',[manager,first.id,doc.id,'En revue','Contrôle']),/revision conflict/);
 await assert.rejects(db.query('select meet_review_document($1,$2,2,$3,$4,$5)',[manager,first.id,doc.id,'Validé par une personne habilitée','Contrôle']),/insufficient/);
 await db.query('select meet_review_document($1,$2,2,$3,$4,$5)',[manager,first.id,doc.id,'En revue','Contrôle']);
 assert.equal((await db.query('select review from meet_documents where id=$1',[doc.id])).rows[0].review,'En revue');
});
