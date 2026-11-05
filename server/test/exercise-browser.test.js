const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function setup(api={}) {
 let page;const timers=[],app={globalData:{session:{user:{userId:'u'}}}},defaults={listFacets:async()=>({data:{body_parts:[],equipment:[]}}),listExercises:async()=>({data:[],total:0})}
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../miniprogram/pages/exercises/index.js'),'utf8'),{Page:p=>page=p,require:id=>id.includes('guard')?{requireLogin:()=>true}:Object.assign(defaults,api),getApp:()=>app,wx:{navigateTo(){}},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){}})
 page.data=JSON.parse(JSON.stringify(page.data));page.setData=function(v){Object.assign(this.data,v)};return {page,timers}
}
test('exercise browser ignores stale filter responses and keeps zero totals accurate',async()=>{
 const pending=[];const {page}=setup({listExercises:(app,query)=>new Promise(resolve=>pending.push({query,resolve}))})
 const old=page.reload();page.setData({equipment:'dumbbell'});const current=page.reload()
 pending[1].resolve({data:[],total:0});await current;pending[0].resolve({data:[{id:'old'}],total:20});await old
 assert.equal(page.data.total,0);assert.equal(page.data.list.length,0);assert.equal(pending[1].query.equipment,'dumbbell');assert.equal(page.data.loading,false)
})
test('search invalidates in-flight pagination before debounce and retains selected filters',async()=>{
 let release;const queries=[];const {page,timers}=setup({listExercises:(app,query)=>{queries.push(query);if(query.page===2)return new Promise(r=>release=r);return Promise.resolve({data:[{id:query.q||'first'}],total:4})}})
 page.setData({bodyPart:'chest',equipment:'barbell'});await page.reload();const more=page.loadMore();page.onSearch({detail:{value:'卧推'}})
 release({data:[{id:'stale'}],total:4});await more;assert.equal(page.data.list.length,0);await timers[0]();assert.equal(page.data.list[0].id,'卧推');assert.equal(queries[2].body_part,'chest');assert.equal(queries[2].equipment,'barbell')
})
test('pagination deduplicates rapid lower events and retries without discarding existing results',async()=>{
 let calls=0,fail=true;const {page}=setup({listExercises:async()=>{calls++;if(fail)throw Error('断网');return {data:[{id:'b'}],total:2}}})
 page.setData({list:[{id:'a'}],page:1,hasMore:true});await Promise.all([page.loadMore(),page.loadMore()]);assert.equal(calls,1);assert.equal(page.data.page,1);assert.equal(page.data.list.length,1);assert.equal(page.data.error,'断网')
 fail=false;await page.onRetry();assert.equal(page.data.page,2);assert.equal(page.data.list.length,2);assert.equal(page.data.error,'');assert.equal(page.data.hasMore,false)
})
test('returning from detail preserves browser results; broken image has local fallback',async()=>{
 let calls=0;const {page}=setup({listExercises:async()=>{calls++;return {data:[{id:'a',name:'长动作名称'}],total:1}}})
 page.onShow();await new Promise(r=>setImmediate(r));page.onShow();assert.equal(calls,1)
 page.onImageError({currentTarget:{dataset:{id:'a'}}});assert.equal(page.data.list[0].imageFailed,true);assert.equal(page.data.list[0].name,'长动作名称')
 page.onUnload();assert.equal(page._unloaded,true)
})
