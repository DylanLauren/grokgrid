import { createConnection } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
function parse(buf:Buffer,at=0):{value:any;end:number}|null{
 const line=buf.indexOf('\r\n',at);if(line<0)return null
 const kind=String.fromCharCode(buf[at]),text=buf.toString('utf8',at+1,line);let end=line+2
 if(kind==='-')throw Error(text)
 if(kind==='+')return {value:text,end}
 if(kind===':')return {value:Number(text),end}
 if(kind==='$'){const size=Number(text);if(size===-1)return {value:null,end};if(buf.length<end+size+2)return null;return {value:buf.toString('utf8',end,end+size),end:end+size+2}}
 if(kind==='*'){const n=Number(text);if(n===-1)return {value:null,end};const value=[];for(let i=0;i<n;i++){const next=parse(buf,end);if(!next)return null;value.push(next.value);end=next.end}return {value,end}}
 throw Error('Unsupported test RESP')
}
export async function localRedis(binary:string){
 const root=await mkdtemp('/tmp/gg-redis-'),socket=join(root,'redis.sock')
 const child=spawn(binary,['--port','0','--unixsocket',socket,'--unixsocketperm','700','--save','','--appendonly','no','--dir',root],{stdio:'ignore'})
 const command=(...args:(string|number)[])=>new Promise<any>((resolve,reject)=>{
  const client=createConnection(socket);let buffer=Buffer.alloc(0),settled=false
  const done=(err:Error|null,value?:any)=>{if(settled)return;settled=true;client.destroy();if(err)reject(err);else resolve(value)}
  client.setTimeout(5000,()=>done(Error('Local Redis timed out')))
  client.on('error',error=>done(error));client.on('connect',()=>client.write(`*${args.length}\r\n`+args.map(x=>`$${Buffer.byteLength(String(x))}\r\n${x}\r\n`).join('')))
  client.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);try{const result=parse(buffer);if(result)done(null,result.value)}catch(error){done(error as Error)}})
 })
 let ready=false
 for(let i=0;i<100;i++){try{await command('PING');ready=true;break}catch{await pause(20)}}
 if(!ready){child.kill('SIGKILL');await rm(root,{recursive:true,force:true});throw Error('Local Redis failed to start')}
 return {command,async close(){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;await rm(root,{recursive:true,force:true})}}
}
