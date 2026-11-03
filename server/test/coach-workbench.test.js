const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'../../miniprogram')
function recording(){
 const events={},calls=[]
 const recorder={start(){calls.push('start')},stop(){calls.push('stop')},pause(){calls.push('pause')},resume(){calls.push('resume')}}
 for(const name of ['Start','Stop','Error','Pause','Resume','InterruptionBegin'])recorder['on'+name]=fn=>{events[name]=fn}
 const context={module:{exports:{}},wx:{getRecorderManager:()=>recorder}}
 vm.runInNewContext(fs.readFileSync(path.join(root,'utils/speechComposer.js'),'utf8'),context)
 return {create:context.module.exports.createSpeechComposer,events,calls}
}
test('recording waits for native start, supports pause, prevents double stop and holds ownership during ASR',()=>{
 const {create,events,calls}=recording();let started=0,job,final
 const a=create({onStart:()=>started++,onNeedAsr:j=>job=j,onFinal:text=>final=text}),b=create({})
 assert.equal(a.start('原有内容'),true);assert.equal(started,0);assert.equal(b.start(),false)
 events.Start();assert.equal(started,1);assert.equal(a.pause(),true);events.Pause();assert.equal(a.resume(),true);events.Resume()
 assert.equal(a.stop(),true);assert.equal(a.stop(),false);assert.equal(calls.filter(x=>x==='stop').length,1)
 events.Stop({tempFilePath:'voice.mp3'});assert.equal(b.start(),false)
 job.finish('新增内容');assert.equal(final,'原有内容 新增内容');assert.equal(b.start(),true);b.destroy()
})
test('destroyed recorder callbacks never submit audio or update the unloaded page',()=>{
 const {create,events}=recording();let writes=0
 const a=create({onNeedAsr:()=>writes++,onFinal:()=>writes++})
 a.start();a.destroy();events.Stop({tempFilePath:'voice.mp3'});events.Error({message:'late'})
 assert.equal(writes,0)
})
function page(){
 let p;const app={globalData:{session:{user:{userId:'coach'}},drafts:{}},persist(){},toast(){}}
 vm.runInNewContext(fs.readFileSync(path.join(root,'pages/record/index.js'),'utf8'),{Page:x=>p=x,require:()=>({EXERCISE_LIBRARY:[]}),getApp:()=>app,wx:{},console})
 p.data=JSON.parse(JSON.stringify(p.data));p.setData=function(v){Object.assign(this.data,v)}
 return {p,app}
}
test('failed field save remains pending, blocks leaving, and can be retried without losing edits',async()=>{
 const {p}=page();let fail=true,count=0
 const write=()=>{count++;if(fail)return Promise.reject(Error('断网'));return Promise.resolve({data:{session_id:'s',revision:2}})}
 assert.equal(await p.queueWrite('field',write),false);assert.equal(p.data.saveError,'断网');assert.equal(p.canLeave(),false)
 fail=false;assert.equal(await p.flushWrites(),true);assert.equal(count,2);assert.equal(p.data.session.revision,2);assert.equal(p.data.saveError,'');assert.equal(p.canLeave(),true)
})
test('field saves serialize and newer value for the same field is not discarded',async()=>{
 const {p}=page();let release;const order=[]
 const first=p.queueWrite('weight',()=>new Promise(resolve=>{release=()=>{order.push(50);resolve({data:{revision:1}})}}))
 await Promise.resolve();p.queueWrite('weight',async()=>{order.push(55);return {data:{revision:2}}});release()
 assert.equal(await first,true);assert.deepEqual(order,[50,55]);assert.equal(p.data.session.revision,2)
})
test('local entry drafts are scoped to coach, student and session, and completed records are not overwritten',()=>{
 const {p,app}=page();p.setData({studentId:'student',session:{session_id:'one',status:'in_progress'},textInput:'卧推'})
 p.saveLocalDraft();assert.equal(app.globalData.drafts['coach-entry:coach:student:one'].textInput,'卧推')
 p.setData({session:{session_id:'two',status:'completed'},textInput:'不应保存'});p.saveLocalDraft()
 assert.equal(app.globalData.drafts['coach-entry:coach:student:two'],undefined)
})
test('sync checks the currently focused field even before blur and rejects incomplete input',()=>{
 const {p}=page();let commits=0
 p.setData({session:{status:'in_progress'}})
 p.onFieldInput({currentTarget:{dataset:{sid:'set',field:'actualReps'}},detail:{value:''}})
 assert.equal(p.commitFieldInputs(),false)
 p.onFieldInput({currentTarget:{dataset:{sid:'set',field:'actualReps'}},detail:{value:'5'}})
 p.onSetField=e=>{commits++;assert.equal(e.detail.value,'5')}
 assert.equal(p.commitFieldInputs(),true);assert.equal(commits,1)
})
