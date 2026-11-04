const {test}=require('node:test')
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const {createRequire}=require('node:module')
const root=path.join(__dirname,'../../miniprogram')
function loadPage(name,wx={}){
 let page
 const file=path.join(root,'pages',name,'index.js')
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),Page:p=>page=p,wx,getApp:()=>global.getApp(),console})
 page.data=JSON.parse(JSON.stringify(page.data));page.setData=function(v){Object.assign(this.data,v)}
 return page
}
test('role choice is absent from all routed page templates',()=>{
 const routes=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8')).pages
 for(const route of routes)assert.ok(!fs.readFileSync(path.join(root,route+'.wxml'),'utf8').includes('<role-switcher'),route)
})
test('each role exposes exactly its three task-oriented primary tabs and profile remains reachable',()=>{
 let component
 const file=path.join(root,'components/bottom-nav/index.js')
 for(const role of ['coach','student']){
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),Component:c=>component=c,getApp:()=>({globalData:{role}})})
  const instance={data:{},setData(v){Object.assign(this.data,v)}}
  component.methods.refresh.call(instance)
  const items=instance.data.items
  assert.equal(items.length,3)
  assert.equal(items.map(x=>x.text).join(','),role==='coach'?'工作台,学员,日程':'课程,记录,进展')
  assert.ok(!items.some(x=>x.path==='/pages/profile/index'))
  if(role==='coach')assert.ok(items.some(x=>x.key==='students'))
 }
 const home=fs.readFileSync(path.join(root,'pages/home/index.wxml'),'utf8')
 assert.ok(home.includes('bindtap="goRecord"'))
 assert.ok(home.includes('bindtap="goProfile"'))
})
test('growth tool links select the correct existing tool detail',()=>{
 const urls=[],wx={navigateTo:x=>urls.push(x.url)}
 const growth=loadPage('growth',wx),ai=loadPage('ai',wx)
 for(const [index,tool] of ['food','posture','goal'].entries()){
  growth.goTool({currentTarget:{dataset:{tool}}})
  assert.equal(urls[index],'/pages/ai/index?tool='+tool)
  ai.onLoad({tool});assert.equal(ai.data.toolSwiperCurrent,index)
 }
 growth.goTool({currentTarget:{dataset:{tool:'invalid'}}});assert.equal(urls.length,3)
 const profile=fs.readFileSync(path.join(root,'pages/profile/index.wxml'),'utf8')
 assert.ok(!profile.includes('专属工具'));assert.ok(profile.includes('账号信息'))
})
test('profile switches both directions only for server-granted roles and restores student subject',()=>{
 const oldGetApp=global.getApp,oldWx=global.wx
 try{
  const redirects=[],messages=[]
  const app={globalData:{role:'coach',activeSubjectId:'someone_else',session:{user:{userId:'self'},grantedRoles:['coach','student']}},persist(){this.saved=true},toast:m=>messages.push(m)}
  global.getApp=()=>app;global.wx={redirectTo:x=>redirects.push(x.url)}
  const profile=loadPage('profile');profile.route='pages/profile/index'
  profile.onSwitchRole();assert.equal(app.globalData.role,'student');assert.equal(app.globalData.activeSubjectId,'self');assert.equal(redirects[0],'/pages/home/index');assert.ok(app.saved)
  profile.onSwitchRole();assert.equal(app.globalData.role,'coach')
  app.globalData.role='student';app.globalData.session.grantedRoles=['student']
  profile.onSwitchRole();assert.equal(app.globalData.role,'student');assert.equal(redirects.length,2);assert.equal(messages.length,1)
 }finally{global.getApp=oldGetApp;global.wx=oldWx}
})
