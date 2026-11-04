const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const {createTestApp}=require('./helpers')

test('schedule exceptions require owning coach and validate time without mutating on failure',async()=>{
  const ctx=createTestApp()
  try{
    const student=await ctx.login('student_only'),coach=await ctx.login('coach_approved')
    const body={startAt:Date.now()+86400000,endAt:Date.now()+90000000,type:'closed',reason:'isolated regression'}
    const request=(token,id,body)=>ctx.request('POST',`/api/v1/coaches/${id}/exceptions`,{token,body})
    const before=ctx.store.state.schedule.exceptions.length
    assert.equal((await request(student.sessionToken,'coach_001',body)).status,403)
    assert.equal((await request(coach.sessionToken,'other_coach',body)).status,403)
    for(const patch of [{endAt:0},{startAt:'123'},{type:'invalid'},{startAt:null}]){
      assert.equal((await request(coach.sessionToken,'coach_001',{...body,...patch})).status,422)
    }
    assert.equal(ctx.store.state.schedule.exceptions.length,before)
    const good=await request(coach.sessionToken,'coach_001',body)
    assert.equal(good.status,200);assert.equal(ctx.store.state.schedule.exceptions.length,before+1)
    assert.equal(good.body.data.coachId,'coach_001')
    await ctx.store.tx(state=>{const u=state.users.find(u=>u.userId===coach.user.userId);u.coachProfile=null})
    assert.equal((await request(coach.sessionToken,'coach_001',body)).status,403)
  }finally{await ctx.cleanup()}
})

test('API config uses local environment overrides and never leaks localhost into releases',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../miniprogram/config.js'),'utf8')
  function config(env,overrides){const module={exports:{}};vm.runInNewContext(source,{module,require(){if(!overrides)throw Error('not generated');return overrides},wx:{getAccountInfoSync:()=>({miniProgram:{envVersion:env}})}});return module.exports}
  assert.equal(config('develop',{develop:'http://192.168.31.69:8787/api/v1'}).API_BASE_URL,'http://192.168.31.69:8787/api/v1')
  assert.equal(config('develop').API_BASE_URL,'http://127.0.0.1:8787/api/v1')
  assert.equal(config('release',{develop:'http://127.0.0.1'}).API_BASE_URL,'')
  assert.equal(config('trial',{trial:'http://insecure.example'}).API_BASE_URL,'')
  assert.equal(config('release',{release:'https://api.example/api/v1'}).API_BASE_URL,'https://api.example/api/v1')
})
