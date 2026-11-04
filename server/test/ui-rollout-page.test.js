const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { trainingOverview, upcoming } = require('../../miniprogram/utils/homePresenter')
const time = require('../../miniprogram/utils/time')
const root = path.resolve(__dirname, '../../miniprogram')
const active = { session_id:'active', source_type:'from_plan', status:'in_progress', title:'进行中卧推', done_sets:1, exercises:[{name:'卧推',sets:[{},{}]}] }
function setup(role = 'student', overrides = {}) {
  let page
  const calls = []
  const app = { globalData: { role, session:{user:{userId:'u1',displayName:'测试',coachProfile:role === 'coach' ? {coachId:'c1'} : null},grantedRoles:role === 'coach' ? ['student','coach'] : ['student']} }, persist(){}, toast(){} }
  const training = {
    listPlansForStudent: async () => { calls.push('plans'); return {data:[]} },
    listSessions: async () => { calls.push('sessions'); return {data:[active]} }, ...overrides.training
  }
  const binding = {
    refreshMe: async () => ({grantedRoles:app.globalData.session.grantedRoles}),
    getActivePrimaryCoach: () => ({coachName:'林野',coachId:'c1'}),
    listBoundStudentsForCoachAsync: async () => { calls.push('students'); return [{name:'学员甲',studentId:'s1'}] }, ...overrides.binding
  }
  const booking = { listBookings: async (app, query) => { calls.push(query.dateKey ? 'today-bookings':'bookings'); return {data:[]} }, statusLabel:value => value, ...overrides.booking }
  const growth = { getSummary:async () => {calls.push('growth');return {data:{sessionCount:2,trainingDays:2,planCompletionRate:50,empty:{volume:false},volumeKg:400}}}, ...overrides.growth }
  const dependencies = {'../../utils/role':{syncRoleBar(p){p.setData({role:app.globalData.role,canSwitchCoach:app.globalData.role==='coach'})},goProfile(){}},'../../utils/guard':{requireLogin:()=>true},'../../utils/permission':{canActivateRole:()=>role==='coach'},'../../utils/time':time,'../../utils/homePresenter':{trainingOverview,upcoming},'../../services/bindingApi':binding,'../../services/bookingApi':booking,'../../services/growthApi':growth,'../../services/trainingApi':training}
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/home/index.js'),'utf8'),{Page:p=>{page=p},getApp:()=>app,wx:{},require:id=>{if(!(id in dependencies))throw Error(id);return dependencies[id]}})
  page.setData = function(values){Object.assign(this.data,values)}
  return {page,app,calls}
}
test('homepage only describes a plan as today when its published date matches; active workout takes priority',()=>{
  const plans = [{plan_id:'p1',published:{title:'未来计划',planned_date:'2026-12-01',exercises:[]}}]
  assert.equal(trainingOverview(null,plans,'2026-10-28',[]).todayPlan,null)
  const view = trainingOverview(active,plans,'2026-10-28',[])
  assert.equal(view.trainingTitle,'进行中卧推');assert.equal(view.progressPercent,50);assert.equal(view.trainingAction,'继续训练')
})
test('homepage marks today plan complete and routes CTA to growth copy',()=>{
  const plans = [{plan_id:'p-today',published:{title:'今日下肢',planned_date:'2026-10-28',exercises:[{name:'深蹲',sets:[{},{}]}]}}]
  const sessions = [{plan_id:'p-today',status:'completed',business_date:'2026-10-28',source_type:'from_plan',done_sets:2}]
  const view = trainingOverview(null,plans,'2026-10-28',sessions)
  assert.equal(view.todayPlanDone,true)
  assert.equal(view.trainingAction,'今日已完成')
  assert.equal(view.progressPercent,100)
})
test('homepage upcoming course excludes expired and cancelled rows',()=>{
  const now=Date.now(), next={status:'pending',startAt:now+60000}
  assert.equal(upcoming([{status:'confirmed',startAt:now-1},{status:'cancelled',startAt:now+1},next],now),next)
})
test('student homepage presents live session and statistics without querying coach-only students',async()=>{
  const {page,calls}=setup();await page.refreshPage()
  assert.equal(page.data.trainingTitle,'进行中卧推');assert.equal(page.data.weekCount,2);assert.equal(page.data.planRateText,'50%')
  assert.equal(page.data.loading,false);assert.equal(calls.includes('students'),false)
})
test('coach homepage uses its own profile and actual day courses, without querying learner training',async()=>{
  const {page,calls}=setup('coach',{booking:{listBookings:async(app,query)=>({data:query.dateKey ? [{booking_id:'b1',status:'confirmed',startAt:2},{booking_id:'b2',status:'cancelled',startAt:1}] : [{status:'pending'}]})}})
  await page.refreshPage();assert.equal(page.data.todayCourseCount,1);assert.equal(page.data.pendingCoachCount,1);assert.equal(page.data.boundCount,1)
  assert.equal(calls.includes('plans'),false);assert.equal(calls.includes('growth'),false)
})
test('failed homepage API is visible and does not invent training content',async()=>{
  const {page}=setup('student',{training:{listPlansForStudent:async()=>{throw Error('网络不可用')}}})
  await page.refreshPage();assert.equal(page.data.trainingError,'网络不可用');assert.equal(page.data.activeSession,null);assert.equal(page.data.loading,false)
})
test('stale homepage response cannot overwrite a different account',async()=>{
  let resolve
  const {page,app}=setup('student',{training:{listSessions:()=>new Promise(r=>{resolve=r})}})
  const old=page.refreshPage();app.globalData.session.user.userId='u2';page.setData({trainingTitle:'另一账号'})
  resolve({data:[active]});await old;assert.equal(page.data.trainingTitle,'另一账号')
})
test('all routed native pages register their custom components and bound handlers',()=>{
  const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'))
  const nativeHyphen=new Set(['scroll-view','swiper-item','picker-view','picker-view-column','radio-group','checkbox-group','rich-text','web-view','cover-view','cover-image','camera','live-player','live-pusher','page-container','root-portal','movable-area','movable-view','match-media','navigation-bar'])
  for(const route of app.pages){
    const sourceFile=path.join(root,route+'.js'),wxml=fs.readFileSync(path.join(root,route+'.wxml'),'utf8'),config=JSON.parse(fs.readFileSync(path.join(root,route+'.json'),'utf8'))
    let definition
    vm.runInNewContext(fs.readFileSync(sourceFile,'utf8'),{require:createRequire(sourceFile),Page:p=>{definition=p},wx:{},getApp:()=>({globalData:{}}),console})
    for(const match of wxml.matchAll(/\b(?:bind|catch)(?::?[a-zA-Z]+)="([a-zA-Z_]\w*)"/g))assert.equal(typeof definition[match[1]],'function',route+': missing event '+match[1])
    for(const match of wxml.matchAll(/<([a-z][\w]*-[\w-]+)/g))if(!nativeHyphen.has(match[1]))assert.ok((config.usingComponents||{})[match[1]]||(app.usingComponents||{})[match[1]],route+': unregistered '+match[1])
  }
})
test('diary accordion exposes each record section through its toggle handler',()=>{
  const wxml=fs.readFileSync(path.join(root,'pages/diary/index.wxml'),'utf8')
  let page
  const source=path.join(root,'pages/diary/index.js')
  vm.runInNewContext(fs.readFileSync(source,'utf8'),{Page:p=>{page=p},require:createRequire(source),wx:{},getApp:()=>({})})
  page.setData=function(values){Object.assign(this.data,values)}
  assert.ok(wxml.includes('bindtap="onTogglePanel"'))
  const sections=page.buildAccordion({meals:[],sessions:[],coachNotes:[],shares:{}})
  page.setData({openPanel:''})
  for(const section of sections){page.onTogglePanel({currentTarget:{dataset:{id:section.id}}});assert.equal(page.data.openPanel,section.id);page.onTogglePanel({currentTarget:{dataset:{id:section.id}}});assert.equal(page.data.openPanel,'')}
  assert.ok(sections.some(x=>x.id==='training'))
})
test('coach record composer keeps typed text while voice handlers exist',()=>{
  let page
  const source=path.join(root,'pages/record/index.js')
  const wxStub={getSetting(opts){opts&&opts.fail&&opts.fail()},authorize(){},getRecorderManager(){return {start(){},stop(){},onStop(){},onError(){}}},getFileSystemManager(){return {readFile(){}}}}
  vm.runInNewContext(fs.readFileSync(source,'utf8'),{Page:p=>{page=p},require:createRequire(source),wx:wxStub,getApp:()=>({globalData:{},toast(){}})})
  page.setData=function(values){Object.assign(this.data,values)}
  page.onLoad()
  page.setData({textInput:'卧推 50kg 5次 3组',session:{status:'in_progress'},voiceBusy:false,syncing:false})
  assert.equal(page.data.textInput,'卧推 50kg 5次 3组')
  assert.equal(typeof page.onRecStart,'function')
  assert.equal(typeof page.onRecEnd,'function')
  assert.equal(typeof page.onNoteRecStart,'function')
  assert.equal(typeof page.onParseText,'function')
  page.setData({recording:true})
  page.onTextInput({detail:{value:'卧推 50kg 5次 3组 已编辑'}})
  assert.equal(page.data.textInput,'卧推 50kg 5次 3组 已编辑')
})
test('coach sync serializes set completion and finalizes the revision actually returned by API',async()=>{
  let page, modal, writes=0, finalizations=0
  const initial={session_id:'c-session',revision:1,exercises:[{sets:[{id:'a',state:'pending'},{id:'b',state:'pending'}]}]}
  const api={
    EXERCISE_LIBRARY:[],async updateActualSet(){writes++;return {data:{...initial,revision:1+writes}}},
    async finalizeSession(app,id,opts){finalizations++;assert.equal(opts.baseRevision,3);return {data:{session:{...initial,status:'completed',revision:4}}}}
  }
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/record/index.js'),'utf8'),{Page:p=>{page=p},require:id=>id.includes('trainingApi')?api:{},getApp:()=>({toast(){}}),wx:{showModal(options){modal=options}}})
  page.setData=function(values){Object.assign(this.data,values)};page.setData({session:initial})
  page.onFinalize();page.onFinalize();modal.success({confirm:true})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(writes,2);assert.equal(finalizations,1);assert.equal(page.data.syncing,false)
})
