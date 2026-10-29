import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { startLivePhone, startVisibleLivePhone, retryAfterMilliseconds, validPhoneSession } from '../src/ui/livePhoneSession'
const session={url:'wss://test.livekit.cloud',token:'test-viewer-token',room:'grokgrid-house',trackName:'synthesized-camera'}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
class Video extends EventTarget {
 srcObject:unknown=null;frame?:()=>void;frames=0;pauses=0;plays=0
 pause(){this.pauses++} async play(){this.plays++}
 requestVideoFrameCallback(fn:()=>void){this.frame=fn;return ++this.frames}
 cancelVideoFrameCallback(){this.frame=undefined}
 emitFrame(){const frame=this.frame;this.frame=undefined;frame?.()}
}
function fixture(connect?:()=>Promise<void>,timers?:ReturnType<typeof fakeRetryClock>){
 const video=new Video(),states:string[]=[],rooms:FakeRoom[]=[]
 class FakeRoom extends EventEmitter {
  name='grokgrid-house';remoteParticipants=new Map();disconnects=0;connectOptions:unknown
  constructor(){super();rooms.push(this)}
  async connect(_url:string,_token:string,options:unknown){this.connectOptions=options;await connect?.()}
  async disconnect(){this.disconnects++}
 }
 const events={TrackPublished:'published',TrackSubscribed:'subscribed',TrackUnsubscribed:'unsubscribed',TrackSubscriptionFailed:'subscriptionFailed',TrackMuted:'muted',TrackUnmuted:'unmuted',Reconnecting:'reconnecting',Reconnected:'reconnected',Disconnected:'disconnected'}
 const sdk={Room:FakeRoom,RoomEvent:events,Track:{Kind:{Video:'video'}}} as any
 let requests=0,signal:AbortSignal|undefined
 const fetcher=async(input:any,options:any)=>{requests++;signal=options.signal;assert.equal(input,'/api/phone-session');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');return Response.json(session)}
 const dependencies={fetcher:fetcher as typeof fetch,loadClient:async()=>sdk,timers}
 const start=()=>startLivePhone(video as unknown as HTMLVideoElement,s=>states.push(s),dependencies)
 return {video,states,rooms,events,start,dependencies,requests:()=>requests,signal:()=>signal}
}
function publication(name='synthesized-camera',kind='video') { const subscriptions:boolean[]=[];return {trackName:name,kind,isMuted:false,setSubscribed:(value:boolean)=>subscriptions.push(value),subscriptions} }
function track(){return {kind:'video',attaches:0,detaches:0,attach(video:any){this.attaches++;video.srcObject={}},detach(video:any){this.detaches++;video.srcObject=null}}}
test('session rejects wrong room/track and unsafe URLs without publishing credentials',()=>{
 assert.deepEqual(validPhoneSession(session),session)
 for(const override of [{url:'http://example.test'},{url:'wss://secret@example.test'},{url:'wss://example.test?secret=x'},{room:'other'},{trackName:'other'},{token:''}])assert.throws(()=>validPhoneSession({...session,...override}))
})
test('subscribes only to the pinned publisher video, shows actual decoded frames, and fully disconnects',async()=>{
 const f=fixture(),stop=f.start();try{
  await flush();assert.equal(f.requests(),1);const room=f.rooms[0]
  assert.equal((room.connectOptions as any).autoSubscribe,false)
  const good=publication(),wrongTrack=publication('other'),audio=publication('synthesized-camera','audio')
  room.emit(f.events.TrackPublished,good,{identity:'house-publisher'})
  room.emit(f.events.TrackPublished,wrongTrack,{identity:'house-publisher'})
  room.emit(f.events.TrackPublished,audio,{identity:'house-publisher'})
  room.emit(f.events.TrackPublished,good,{identity:'another-publisher'})
  assert.deepEqual(good.subscriptions,[true]);assert.deepEqual(wrongTrack.subscriptions,[]);assert.deepEqual(audio.subscriptions,[])
  const wrong=track();room.emit(f.events.TrackSubscribed,wrong,good,{identity:'another-publisher'});assert.equal(wrong.attaches,0)
  const real=track();room.emit(f.events.TrackSubscribed,real,good,{identity:'house-publisher'});assert.equal(real.attaches,1)
  assert.notEqual(f.states.at(-1),'playing');f.video.emitFrame();assert.equal(f.states.at(-1),'playing')
  room.emit(f.events.TrackMuted,good,{identity:'house-publisher'});f.video.emitFrame();assert.equal(f.states.at(-1),'waiting')
  room.emit(f.events.TrackUnmuted,good,{identity:'house-publisher'});f.video.emitFrame();assert.equal(f.states.at(-1),'playing')
  stop();await flush();assert.equal(f.video.srcObject,null);assert.ok(real.detaches>0);assert.ok(room.disconnects>0);assert.equal(room.eventNames().length,0);assert.equal(f.signal()?.aborted,true)
  const count=f.states.length;f.video.emitFrame();assert.equal(f.states.length,count)
 }finally{stop()}
})
test('leaving during connect closes the pending room and cannot attach or revive video later',async()=>{
 let connected!:()=>void;const f=fixture(()=>new Promise<void>(resolve=>{connected=resolve})),stop=f.start()
 try{await flush();assert.equal(f.rooms.length,1);stop();const count=f.states.length;connected();await flush();assert.ok(f.rooms[0].disconnects>0);assert.equal(f.states.length,count);assert.equal(f.video.srcObject,null)}finally{stop()}
})
test('leaving before session response prevents SDK loading and all room connections',async()=>{
 let resolve!: (value:Response)=>void,loads=0;const states:string[]=[],video=new Video()
 const stop=startLivePhone(video as unknown as HTMLVideoElement,state=>states.push(state),{fetcher:(()=>new Promise<Response>(r=>{resolve=r})) as typeof fetch,loadClient:async()=>{loads++;throw Error('must not load')}})
 stop();resolve(Response.json(session));await flush();assert.equal(loads,0);assert.deepEqual(states,['connecting'])
})
test('unconfigured backend stays unavailable without creating a room or fabricating playback',async()=>{
 let loads=0;const states:string[]=[],video=new Video();const stop=startLivePhone(video as unknown as HTMLVideoElement,state=>states.push(state),{fetcher:(async()=>Response.json({}, {status:503})) as typeof fetch,loadClient:async()=>{loads++;throw Error('must not load')}})
 try{await flush();assert.equal(loads,0);assert.equal(states.at(-1),'unavailable');assert.equal(video.srcObject,null)}finally{stop()}
})

test('a failed pinned video subscription disconnects and exposes an unavailable fallback',async()=>{
 const f=fixture(),stop=f.start();try{
  await flush();const room=f.rooms[0],pub=publication()
  room.emit(f.events.TrackSubscriptionFailed,'video-sid',{identity:'house-publisher',videoTrackPublications:new Map([['video-sid',pub]])})
  await flush();assert.equal(f.states.at(-1),'unavailable');assert.ok(room.disconnects>0);assert.equal(f.video.srcObject,null)
 }finally{stop()}
})

function fakeRetryClock(){
 let now=1_800_000_000_000,id=0;const tasks=new Map<number,{fn:()=>void,at:number}>()
 return {now:()=>now,set:(fn:()=>void,ms:number)=>{tasks.set(++id,{fn,at:now+ms});return id as unknown as ReturnType<typeof setTimeout>},clear:(id:ReturnType<typeof setTimeout>)=>{tasks.delete(id as unknown as number)},advance:(ms:number)=>{now+=ms;for(const [id,task] of [...tasks])if(task.at<=now){tasks.delete(id);task.fn()}},pending:()=>tasks.size}
}
test('terminal disconnect obtains fresh sessions with backoff and no retry survives leaving',async()=>{
 const timers=fakeRetryClock(),f=fixture(undefined,timers),stop=f.start()
 try{
  await flush()
  for(const [index,delay] of [5000,15000,30000,60000,60000].entries()){
   const old=f.rooms[index];old.emit(f.events.Disconnected);await flush();assert.ok(old.disconnects>0)
   timers.advance(delay-1);await flush();assert.equal(f.requests(),index+1)
   timers.advance(1);await flush();assert.equal(f.requests(),index+2)
  }
  f.rooms.at(-1)!.emit(f.events.Disconnected);await flush();assert.equal(timers.pending(),1)
  stop();assert.equal(timers.pending(),0);timers.advance(120000);await flush();assert.equal(f.requests(),6)
 }finally{stop()}
})
test('429 and 503 honor Retry-After seconds and dates instead of rapid token requests',async()=>{
 const timers=fakeRetryClock(),video=new Video();let requests=0
 const stop=startLivePhone(video as unknown as HTMLVideoElement,()=>{},{timers,fetcher:(async()=>{requests++;return Response.json({}, {status:requests===1?429:503,headers:{'Retry-After':requests===1?'90':new Date(timers.now()+120000).toUTCString()}})}) as typeof fetch})
 try{
  await flush();timers.advance(89999);await flush();assert.equal(requests,1)
  timers.advance(1);await flush();assert.equal(requests,2)
  timers.advance(119999);await flush();assert.equal(requests,2)
  timers.advance(1);await flush();assert.equal(requests,3)
  assert.equal(retryAfterMilliseconds('nonsense',timers.now()),0)
  assert.equal(retryAfterMilliseconds('-1',timers.now()),0)
 }finally{stop()}
})
test('hidden documents disconnect and cancel retries; returning visible starts one fresh session',async()=>{
 class Visibility extends EventTarget {visibilityState='hidden';set(value:string){this.visibilityState=value;this.dispatchEvent(new Event('visibilitychange'))}}
 const visibility=new Visibility(),timers=fakeRetryClock(),f=fixture(undefined,timers)
 const stop=startVisibleLivePhone(f.video as unknown as HTMLVideoElement,s=>f.states.push(s),f.dependencies,visibility as unknown as Document)
 try{
  await flush();assert.equal(f.requests(),0)
  visibility.set('visible');await flush();assert.equal(f.requests(),1)
  visibility.set('visible');await flush();assert.equal(f.requests(),1)
  f.rooms[0].emit(f.events.Disconnected);await flush();assert.equal(timers.pending(),1)
  visibility.set('hidden');assert.equal(timers.pending(),0);assert.equal(f.states.at(-1),'idle')
  timers.advance(120000);await flush();assert.equal(f.requests(),1)
  visibility.set('visible');await flush();assert.equal(f.requests(),2)
  visibility.set('hidden');await flush();assert.ok(f.rooms[1].disconnects>0)
  stop();visibility.set('visible');await flush();assert.equal(f.requests(),2)
 }finally{stop()}
})
test('synchronous initial failure still disposes its attempt and is cancellable',async()=>{
 const timers=fakeRetryClock(),video=new Video();let requests=0
 const stop=startLivePhone(video as unknown as HTMLVideoElement,()=>{},{timers,fetcher:(()=>{requests++;throw Error('offline')}) as typeof fetch})
 assert.equal(requests,1);assert.equal(timers.pending(),1);stop();assert.equal(timers.pending(),0)
})
