import {json,rows,allRows,rpc,service,ingest,saveData,hash} from '../server/platform.js';
import {generate} from './openai.js';
export const config={maxDuration:60};
const patch=(t,q,body)=>service('/rest/v1/'+t+'?'+q,{method:'PATCH',body});
async function model(body){const r=await generate(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)}));if(!r.ok)throw new Error('model_unavailable');const text=await r.text();let done;for(const block of text.split('\n\n')){if(block.startsWith('event: error'))throw new Error('model_incomplete');if(block.startsWith('event: done'))done=JSON.parse(block.split('\ndata: ')[1]);}if(!done)throw new Error('model_incomplete');return done;}
export async function processJob(job){
 const d=(await rows('meet_dossiers','id=eq.'+job.dossier_id))[0];if(!d)throw new Error('missing_dossier');
 const data=structuredClone(d.data);const call=job.call_id?(await rows('meet_calls','id=eq.'+job.call_id))[0]:null;
 const base={societe:d.society,contexte:data.name+' — dossier à qualifier',scenario:call?.config.scenario||'À confirmer'};
 if(job.kind==='extract'){
  const ids=(job.batch||[job]).map(j=>j.payload.segmentId);const segments=await rows('meet_segments','id=in.('+ids.join(',')+')&dossier_id=eq.'+d.id+'&order=position_ms.asc');
  const sources=segments.filter(s=>!data.processed.includes(s.id)).map(s=>({id:s.id,text:s.text,t:s.position_ms,role:s.role,callId:s.call_id,speaker:s.speaker}));if(!sources.length)return;
  const client=sources.filter(s=>s.role!=='advisor');const result=client.length?await model({...base,mode:'extract',sources:client}):{facts:[]};ingest(data,result,sources);await saveData({id:null},d,data,'facts.extracted',{callId:job.call_id,actions:result.actions||[]});
 }else if(job.kind==='summary'){
  // A summary cannot overtake pending extraction or silently overwrite a later correction.
  const pending=await rows('meet_jobs','call_id=eq.'+job.call_id+'&kind=eq.extract&status=neq.done');if(pending.length)throw new Error('waiting_for_extraction');
  const segments=await allRows('meet_segments','call_id=eq.'+job.call_id+'&order=position_ms.asc,id.asc');const transcript=segments.map(s=>'['+s.position_ms+'ms]['+s.role+'] '+s.text).join('\n');
  let summaryInput=transcript;
  if(transcript.length>20000){const sourceHash=await hash(transcript);const parts=[];for(let i=0;i<transcript.length;i+=14000)parts.push({part:parts.length,text:transcript.slice(i,i+14000)});
   await rpc('meet_queue_summary_parts',{p_call:call.id,p_hash:sourceHash,p_parts:parts});const ready=await rows('meet_summary_parts','call_id=eq.'+call.id+'&source_hash=eq.'+sourceHash+'&order=part.asc');if(ready.some(x=>!x.summary))throw new Error('waiting_for_extraction');summaryInput=ready.map(x=>'Extrait '+(x.part+1)+': '+x.summary).join('\n');if(summaryInput.length>80000)throw new Error('summary_requires_chunking');
  }
  const result=await model({...base,mode:'summary',transcript:summaryInput,faits:data.facts,questions:[],temps:{elapsed:Math.round(call.duration_ms/60000),total:call.config.duree}});
  await rpc('meet_commit_summary',{p_job:job.id,p_lease:job.lease_token,p_dossier:d.id,p_revision:d.revision,p_call:call.id,p_text:result.text});
 }else if(job.kind==='summary-part'){
  const part=(await rows('meet_summary_parts','id=eq.'+job.payload.partId+'&dossier_id=eq.'+d.id))[0];if(!part)throw new Error('missing_part');if(part.summary)return;const result=await model({...base,mode:'summaryChunk',transcript:part.input,faits:[],questions:[]});await patch('meet_summary_parts','id=eq.'+part.id,{summary:result.text});
 }else if(job.kind==='document-extract'){
  const s=(await rows('meet_document_sources','id=eq.'+job.payload.sourceId+'&dossier_id=eq.'+d.id))[0];if(!s)throw new Error('missing_source');if(data.processed.includes(s.id))return;
  const source={id:s.id,text:s.text,role:'document',page:s.page,fileId:s.file_id};const result=await model({...base,mode:'extract',sources:[source]});ingest(data,result,[source]);await saveData({id:null},d,data,'document.facts.extracted',{fileId:s.file_id,page:s.page,actions:result.actions||[]});
 }else if(job.kind==='file'){
  const file=(await rows('meet_files','id=eq.'+job.payload.fileId+'&dossier_id=eq.'+d.id))[0];if(!file||file.receipt!=='received')throw new Error('file_not_ready');
  if(!data.evidence.some(e=>e.id===file.id))data.evidence.push({id:file.id,filename:file.filename,fieldId:file.field_id,status:'received',hash:'manifest:'+file.id});
  const parts=await allRows('meet_file_parts','file_id=eq.'+file.id+'&order=part.asc'),buffers=[];for(const part of parts){const r=await service('/storage/v1/object/authenticated/meet-private/'+part.object_key,{binary:true});buffers.push(Buffer.from(await r.arrayBuffer()));}
  const {extractFile}=await import('../server/extract-file.js');const extracted=await extractFile(Buffer.concat(buffers),file.filename);const sources=[];
  for(const page of extracted.pages)for(let offset=0;offset<page.text.length;offset+=12000){const text=page.text.slice(offset,offset+12000);if(!text.trim())continue;const h=await hash(file.id+':'+page.page+':'+offset);const id=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);sources.push({id,page:page.page,part:offset/12000,text});}
  await rpc('meet_queue_document_sources',{p_file:file.id,p_sources:sources,p_state:extracted.state});await saveData({id:null},d,data,'evidence.received',{fileId:file.id});
 }else throw new Error('unknown_job');
}
export async function runWorker(req){if(!process.env.CRON_SECRET||req.headers.get('authorization')!=='Bearer '+process.env.CRON_SECRET)return json(401,{error:'Accès réservé au traitement planifié.'});
 try{const job=await rpc('meet_claim_job',{});if(!job)return json(200,{processed:0});try{
  await processJob(job);await patch('meet_jobs','id=in.('+(job.batch||[job]).map(j=>j.id).join(',')+')&lease_token=eq.'+job.lease_token,{status:'done',last_error:null,lease_until:null});return json(200,{processed:1});
 }catch(e){const waiting=e.message==='waiting_for_extraction'||e.status===409;await patch('meet_jobs','id=in.('+(job.batch||[job]).map(j=>j.id).join(',')+')&lease_token=eq.'+job.lease_token,{status:job.attempts>=6&&!waiting?'failed':'pending',attempts:waiting?job.attempts-1:job.attempts,not_before:new Date(Date.now()+Math.min(300000,15000*2**job.attempts)).toISOString(),lease_until:null,last_error:e.message==='summary_requires_chunking'?'Appel long : consolidation par lots requise.':'Traitement à reprendre ; sources conservées.'});return json(200,{processed:0,retry:true});}
 }catch{return json(503,{error:'File de traitements indisponible.'});}}

export default async function handler(req,res){const result=await runWorker(new Request('https://internal.invalid/api/worker',{method:req.method,headers:req.headers}));res.statusCode=result.status;result.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await result.text());}

