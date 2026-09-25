// The counter, retry and recovery screens share this exact selection.
export const pendingFor=(items,userId)=>items.filter(x=>x.userId===userId&&!x.confirmedAt).sort((a,b)=>Number(a.type==='finish')-Number(b.type==='finish')||(a.enqueuedAt||0)-(b.enqueuedAt||0));
export function createDrainer({read,put,send,userId,onChange=()=>{}}){
 let running;
 return function drain(){
  if(running)return running;
  running=(async()=>{
   const failedCalls=new Set(),errors=[];
   for(const item of pendingFor(await read(),userId)){
    if(item.type==='finish'&&failedCalls.has(item.callId))continue;
    try{
     if(!item.dossierId)throw new Error('Rattachement au dossier à confirmer.');
     onChange({item,state:'uploading'});await send(item);
     // Keep the local source until an explicit retention choice, never delete on ACK.
     await put({...item,confirmedAt:new Date().toISOString(),error:null});
    }catch(e){
     errors.push({id:item.id,message:e.message});if(item.callId)failedCalls.add(item.callId);
     await put({...item,error:e.message}).catch(()=>{});
     if(e.status===401||e.status===428)break;
    }
   }
   const pending=pendingFor(await read(),userId);onChange({state:pending.length?'pending':'idle',pending,errors});return {pending,errors};
  })().finally(()=>{running=null;});return running;
 };
}
export function openQueue(indexedDB){
 const dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('meet-upload-queue',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('pending'))r.result.createObjectStore('pending',{keyPath:'id'});if(!r.result.objectStoreNames.contains('capture'))r.result.createObjectStore('capture',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 async function operation(store,action,value){const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction(store,action==='getAll'?'readonly':'readwrite'),s=tx.objectStore(store),r=action==='getAll'?s.getAll():s[action](value);let result;r.onsuccess=()=>result=r.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Sauvegarde locale interrompue.'));});}
 return {read:()=>operation('pending','getAll'),put:item=>operation('pending','put',item),capture:item=>operation('capture','put',item),captures:()=>operation('capture','getAll'),
  async package(items,item){const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction(['capture','pending'],'readwrite');tx.objectStore('pending').put(item);for(const chunk of items)tx.objectStore('capture').delete(chunk.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Mise en file interrompue.'));});}};
}
