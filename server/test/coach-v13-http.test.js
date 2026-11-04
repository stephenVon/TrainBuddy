const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createTestApp } = require('./helpers')

test('real HTTP: coach history respects binding and private notes; creation replay requires fresh session read', async () => {
  const ctx = createTestApp()
  try {
    const student = await ctx.login('student_only'), coach = await ctx.login('coach_approved'), other = await ctx.login('coach_b')
    await ctx.bindStudent(student.sessionToken)
    const studentId = student.user.userId
    const body = { coachDraft:true, student_id:studentId, title:'隔离验收训练' }
    const create = () => ctx.request('POST','/api/v1/sessions',{token:coach.sessionToken,body,headers:{'Idempotency-Key':'cdraft_'+studentId}})
    const created = await create(); assert.equal(created.status,200)
    const id = created.body.data.session_id
    const hidden = await ctx.request('GET','/api/v1/sessions?student_id='+studentId,{token:student.sessionToken})
    assert.ok(!hidden.body.data.some(s=>s.session_id===id),'learner cannot see unpublished coach draft')
    const meta = await ctx.request('PATCH','/api/v1/sessions/'+id,{token:coach.sessionToken,body:{public_note:'公开测试建议',private_note:'仅教练的合成测试备注'}})
    assert.equal(meta.status,200)
    const finished = await ctx.request('POST','/api/v1/sessions/'+id+'/finalize',{token:coach.sessionToken,body:{base_revision:meta.body.data.revision,completion_key:'v13-http',share:true},headers:{'Idempotency-Key':'v13-http'}})
    assert.equal(finished.status,200)
    const replayed = await create();assert.equal(replayed.body.data.session_id,id)
    const fresh = await ctx.request('GET','/api/v1/sessions/'+id,{token:coach.sessionToken})
    assert.equal(fresh.body.data.status,'completed')
    const visible = await ctx.request('GET','/api/v1/sessions?student_id='+studentId,{token:student.sessionToken})
    const row = visible.body.data.find(s=>s.session_id===id);assert.ok(row);assert.equal(row.private_note,undefined)
    const denied = await ctx.request('GET','/api/v1/sessions?student_id='+studentId,{token:other.sessionToken})
    assert.equal(denied.status,403)
  } finally { await ctx.cleanup() }
})
