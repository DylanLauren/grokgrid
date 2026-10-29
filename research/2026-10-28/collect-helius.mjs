import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname), out=path.join(root,'transactions');await mkdir(out,{recursive:true});
const raw=await readFile('/Users/dylanladrido/coding/fomo-pay/.env.trading.local','utf8');let value=raw.match(/^SOLANA_RPC_URL\s*=\s*(.*)$/m)?.[1]?.trim();if(value?.startsWith('"'))value=JSON.parse(value);else value=value?.replace(/^'|'$/g,'');const key=new URL(value).searchParams.get('api-key');if(!key)throw Error('Existing access unavailable');
const end=Math.floor(Date.parse('2026-10-28T19:02:53Z')/1000), start=end-30*86400;
let calls=0;
for(const file of (await readdir(root)).filter(f=>/^(fomo|pumpfun)-top\d-pnl.json$/.test(f))){
 if(process.env.RESEARCH_FILES&&!process.env.RESEARCH_FILES.split(',').includes(file))continue;
 if(process.env.RESEARCH_FOMO_ONLY==='1'&&!file.startsWith('fomo'))continue;
 const profile=JSON.parse(await readFile(path.join(root,file),'utf8')),wallet=profile.url.split('/').pop(), dest=path.join(out,wallet+'.json');
 let state;try{state=JSON.parse(await readFile(dest,'utf8'));}catch{state={wallet,start,end,records:[],pages:0,complete:false};}
 for(let page=0;page<25&&!state.complete;page++){
  const u=new URL('https://api.helius.xyz/v0/addresses/'+wallet+'/transactions');u.searchParams.set('api-key',key);u.searchParams.set('limit','100');if(state.cursor)u.searchParams.set('before',state.cursor);
  let r,rows;try{r=await fetch(u,{signal:AbortSignal.timeout(20000),redirect:'error'});calls++;if(!r.ok){state.stopReason='http-'+r.status;break;}rows=await r.json();}catch{state.stopReason='request-failed';break;}
  if(!Array.isArray(rows)){state.stopReason='unexpected-response';break;}
  state.pages++;const seen=new Set(state.records.map(t=>t.signature));for(const t of rows)if(!seen.has(t.signature)){state.records.push(t);seen.add(t.signature);}
  const next=rows.at(-1)?.signature;state.complete=!rows.length||rows.some(t=>t.timestamp<start);state.stopReason=state.complete?'cutoff-reached':'page-budget';if(next===state.cursor){state.stopReason='cursor-stalled';break;}state.cursor=next;state.updatedAt=new Date().toISOString();await writeFile(dest+'.tmp',JSON.stringify(state));await rename(dest+'.tmp',dest);
  if(page%5===0)console.log(JSON.stringify({wallet,pages:state.pages,records:state.records.length,oldest:rows.at(-1)?.timestamp,complete:state.complete}));
  await new Promise(r=>setTimeout(r,250));
 }
 await writeFile(dest+'.tmp',JSON.stringify(state));await rename(dest+'.tmp',dest);console.log(JSON.stringify({wallet,records:state.records.length,complete:state.complete,stop:state.stopReason,calls}));
 if(state.stopReason?.startsWith('http-'))break;
}
