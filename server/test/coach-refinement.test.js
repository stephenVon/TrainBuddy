const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
const root=path.resolve(__dirname,'../../miniprogram')
function loadPage(name,wx={},app={globalData:{},toast(){}}){
 let p;const file=path.join(root,'pages',name,'index.js')
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{Page:x=>p=x,require:createRequire(file),wx,getApp:()=>app,console})
 p.data=JSON.parse(JSON.stringify(p.data));p.setData=function(v){Object.assign(this.data,v)};return p
}
function voice(state,canPause=false,busy=false){
 let c;vm.runInNewContext(fs.readFileSync(path.join(root,'components/voice-input/index.js'),'utf8'),{Component:x=>c=x})
 const emitted=[],instance={data:{...c.data},properties:{canPause,state,busy,disabled:false,micDenied:false},setData(v){Object.assign(this.data,v)},triggerEvent(name,value){emitted.push({name,value})}}
 Object.assign(instance,c.methods);c.observers['state, seconds, busy'].call(instance,state,18,busy)
 return {instance,emitted}
}
test('voice UI waits for real start, blocks repeat recording during processing, and exposes real pause capability',()=>{
 for(const state of ['requesting','stopping','processing']){const {instance,emitted}=voice(state);instance.onStart();instance.onStop();assert.equal(emitted.length,0)}
 const {instance,emitted}=voice('recording',true);assert.equal(instance.data.time,'00:18');instance.onPause();instance.onStop();assert.equal(emitted.map(x=>x.name).join(','),'pause,stop')
 const fallback=voice('recording',false);fallback.instance.onPause();fallback.instance.onStop();assert.equal(fallback.emitted.map(x=>x.name).join(','),'stop')
})
test('voice UI preserves text and emits edits without clearing existing content',()=>{
 const {instance,emitted}=voice('idle');instance.properties.text='已有卧推记录';instance.onText({detail:{value:'已有卧推记录，追加划船'}})
 assert.equal(instance.properties.text,'已有卧推记录');assert.equal(emitted[0].value.value,'已有卧推记录，追加划船')
 instance.properties.micDenied=true;instance.onStart();assert.equal(emitted.length,1)
})
test('voice input has a single stop action and fallback never renders a second finish button',()=>{
 const xml=fs.readFileSync(path.join(root,'components/voice-input/index.wxml'),'utf8')
 assert.equal([...xml.matchAll(/bindtap="onStop"/g)].length,1);assert.ok(xml.includes('wx:if="{{canPause}}"'))
 const record=fs.readFileSync(path.join(root,'pages/record/index.wxml'),'utf8')
 assert.ok(!record.includes('bindtap="stopSpeech"'));assert.equal([...record.matchAll(/<voice-input\b/g)].length,2)
})
test('stage changes preserve transcription, candidates and conflict patches, but cannot hide active recording',()=>{
 const p=loadPage('record');p.setData({session:{session_id:'s',status:'in_progress'},studentId:'student',textInput:'卧推50公斤',segments:[{segment_id:'one'}],segmentPatches:{one:{set_count:3}}})
 const text=p.data.textInput,candidates=p.data.segments,patches=p.data.segmentPatches
 for(const stage of ['review','edit','sync','capture']){p.changeRecordStage(stage);assert.equal(p.data.recordStage,stage);assert.equal(p.data.textInput,text);assert.equal(p.data.segments,candidates);assert.equal(p.data.segmentPatches,patches)}
 p.setData({speechState:'paused'});p.changeRecordStage('edit');assert.equal(p.data.recordStage,'capture')
})
test('diagnostics fail closed unless development environment and explicit query both permit them',()=>{
 for(const env of ['release','trial','develop'])for(const query of [{},{diagnostics:'1'}]){
  const p=loadPage('students',{getAccountInfoSync:()=>({miniProgram:{envVersion:env}})});p.onLoad(query);p.onToggleDiagnostics()
  const permitted=env==='develop'&&query.diagnostics==='1';assert.equal(p.data.diagnosticsAllowed,permitted);assert.equal(p.data.showDiagnostics,permitted)
 }
 const missing=loadPage('students');missing.onLoad({diagnostics:'1'});assert.equal(missing.data.diagnosticsAllowed,false)
})
test('coach schedule defaults to day without removing pending or weekly views',()=>{
 const p=loadPage('booking');assert.equal(p.data.coachTab,'day')
 const xml=fs.readFileSync(path.join(root,'pages/booking/index.wxml'),'utf8')
 for(const value of ['day','week','pending'])assert.ok(xml.includes('data-tab="'+value+'"'))
 assert.ok(xml.includes('wx:if="{{showScheduleTools}}"'));assert.equal(p.data.showScheduleTools,false)
})
test('refined navigation retains learner icon assets when changing roles on the same component',()=>{
 let c;const file=path.join(root,'components/bottom-nav/index.js'),app={globalData:{role:'coach'}}
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),Component:x=>c=x,getApp:()=>app})
 const p={data:{},setData(v){Object.assign(this.data,v)}};c.methods.refresh.call(p);const coachIcon=p.data.activeIcons.home
 app.globalData.role='student';c.methods.refresh.call(p);assert.equal(p.data.items.map(x=>x.text).join(','),'课程,记录,进展');assert.notEqual(p.data.activeIcons.home,coachIcon)
})
test('record reads current session after creation replay, so completed records never masquerade as editable drafts',async()=>{
 let p,reads=0;const file=path.join(root,'pages/record/index.js'),original=createRequire(file)
 const api={EXERCISE_LIBRARY:[],createCoachDraftSession:async()=>({data:{session_id:'old',status:'in_progress'}}),getSession:async(app,id)=>{reads++;assert.equal(id,'old');return {data:{session_id:id,status:'completed',public_note:'最新建议'}}}}
 const app={globalData:{session:{user:{userId:'coach'}},drafts:{'coach-entry:coach:student:old':{publicNote:'过时本地建议'}}},toast(){}}
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{Page:x=>p=x,require:id=>id.includes('trainingApi')?api:original(id),wx:{},getApp:()=>app,console})
 p.setData=function(v){Object.assign(this.data,v)};p.setData({studentId:'student'});p.findNextPlan=()=>{}
 await p.loadDraftSession('student','测试学员');assert.equal(reads,1);assert.equal(p.data.session.status,'completed');assert.equal(p.data.publicNote,'最新建议');assert.equal(p.data.recordStage,'sync')
})
test('failed text processing preserves original input and exposes a persistent retryable error',async()=>{
 let p;const file=path.join(root,'pages/record/index.js'),original=createRequire(file)
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{Page:x=>p=x,require:id=>id.includes('voiceApi')?{createTask:async()=>{throw Error('网络暂不可用')}}:original(id),getApp:()=>({toast(){}}),wx:{},console})
 p.setData=function(v){Object.assign(this.data,v)};p.setData({session:{session_id:'draft',status:'in_progress',revision:1},textInput:'卧推50公斤5次'})
 await p.onParseText();assert.equal(p.data.textInput,'卧推50公斤5次');assert.equal(p.data.syncError,'网络暂不可用');assert.equal(p.data.voiceBusy,false)
})
