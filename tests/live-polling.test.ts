import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LIVE_FAST_MS, LIVE_ROOM_MS, startLivePolling } from '../src/data/livePolling'
function fakeClock(){
 let time=0,id=0;const tasks=new Map<number,{fn:()=>void,at:number}>()
 return {now:()=>time,set:(fn:()=>void,ms:number)=>{tasks.set(++id,{fn,at:time+ms});return id as unknown as ReturnType<typeof setTimeout>},clear:(key:ReturnType<typeof setTimeout>)=>{tasks.delete(key as unknown as number)},advance:(ms:number)=>{time+=ms;for(const [key,task] of [...tasks])if(task.at<=time){tasks.delete(key);task.fn()}},pending:()=>tasks.size}
}
const flush=async()=>{await Promise.resolve();await Promise.resolve()}
test('active room polls well before frame expiry and starts immediately when watching changes',async()=>{
 assert.ok(LIVE_ROOM_MS<=5_000);assert.ok(LIVE_FAST_MS<=LIVE_ROOM_MS)
 const timers=fakeClock();let calls=0
 const stop=startLivePolling(async()=>{calls++},LIVE_ROOM_MS,timers)
 assert.equal(calls,1);await flush();timers.advance(LIVE_ROOM_MS-1);assert.equal(calls,1);timers.advance(1);assert.equal(calls,2)
 stop();await flush();const stopFast=startLivePolling(async()=>{calls++},LIVE_FAST_MS,timers);assert.equal(calls,3);stopFast();await flush();assert.equal(timers.pending(),0)
})
test('a slow request is not overlapped or cancelled at the polling interval; stopping prevents later work',async()=>{
 const timers=fakeClock();let calls=0,release!:()=>void,signal!:AbortSignal
 const stop=startLivePolling(async(s)=>{calls++;signal=s;await new Promise<void>(resolve=>{release=resolve})},LIVE_FAST_MS,timers)
 timers.advance(5_000);assert.equal(calls,1);assert.equal(signal.aborted,false)
 release();await flush();timers.advance(0);assert.equal(calls,2)
 stop();assert.equal(signal.aborted,true);release();await flush();timers.advance(100_000);assert.equal(calls,2);assert.equal(timers.pending(),0)
})
test('hung requests time out without starting concurrent work',async()=>{
 const timers=fakeClock();let calls=0,signal!:AbortSignal,release!:()=>void
 const stop=startLivePolling(async(s)=>{calls++;signal=s;await new Promise<void>(resolve=>{release=resolve})},LIVE_ROOM_MS,timers)
 timers.advance(8_000);assert.equal(signal.aborted,true);assert.equal(calls,1)
 timers.advance(50_000);assert.equal(calls,1)
 release();await flush();timers.advance(0);assert.equal(calls,2)
 stop();release();await flush();assert.equal(timers.pending(),0)
})
