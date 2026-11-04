const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
const root=path.resolve(__dirname,'../../miniprogram')
function page(name,wx={},override={}){let p;const file=path.join(root,'pages',name,'index.js'),original=createRequire(file);vm.runInNewContext(fs.readFileSync(file,'utf8'),{Page:x=>p=x,require:id=>override[id]||original(id),wx,getApp:()=>({globalData:{},toast(){}}),console});p.data=JSON.parse(JSON.stringify(p.data));p.setData=function(v){Object.assign(this.data,v)};return p}
test('schedule demo writes require development and explicit query; release cannot enable them',()=>{
 for(const env of ['develop','trial','release'])for(const query of [{},{demo:'1'}]){const p=page('schedule-rules',{getAccountInfoSync:()=>({miniProgram:{envVersion:env}})});p.onLoad(query);assert.equal(p.data.demoTools,env==='develop'&&query.demo==='1');if(!p.data.demoTools){p.onAddSunday();p.onCloseTomorrowMorning()}}
})
test('posture deep link selects standalone mode while ordinary AI page retains carousel',()=>{
 const p=page('ai');p.onLoad({tool:'posture'});assert.equal(p.data.directPosture,true);assert.equal(p.data.toolSwiperCurrent,1);p.onLoad({});assert.equal(p.data.directPosture,false)
})
test('candidate editing stays open for multi-digit entry and invalid counts remain unconfirmed',()=>{
 const p=page('record');p.setData({segments:[{segment_id:'s',set_count:null,candidate_reps_per_set:5,display_name:'卧推'}]});
 for(const value of ['1','12']){p.onSegPatch({currentTarget:{dataset:{sid:'s',f:'set_count'}},detail:{value}});assert.equal(p.data.segments[0].editing,true);assert.equal(p.data.segments[0].set_count,Number(value))}
 p.onSegPatch({currentTarget:{dataset:{sid:'s',f:'set_count'}},detail:{value:'1.5'}});assert.equal(p.data.segments[0].set_count,null);assert.equal(p.data.segments[0].requires_confirmation,true)
})
test('student training responses cannot overwrite a newly selected student',async()=>{
 let resolve;const p=page('student-profile',{}, {'../../services/trainingApi':{listSessions:()=>new Promise(r=>resolve=r)}});p.setData({studentId:'a'});const request=p.reloadTraining();p.setData({studentId:'b',trainingHistory:[{title:'B'}]});resolve({data:[{title:'A'}]});await request;assert.equal(p.data.trainingHistory[0].title,'B')
})
