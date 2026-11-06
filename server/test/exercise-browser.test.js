const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
function setup(api={},wx={}) {
 let page;const timers=[],app={globalData:{session:{user:{userId:'u'}}}},defaults={listFacets:async()=>({data:{body_parts:[],equipment:[]}}),listExercises:async()=>({data:[],total:0})}
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../miniprogram/pages/exercises/index.js'),'utf8'),{Page:p=>page=p,require:id=>id.includes('guard')?{requireLogin:()=>true}:Object.assign(defaults,api),getApp:()=>app,wx:Object.assign({navigateTo(){}},wx),setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){}})
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
test('completed body section continues into next category without losing preceding cards or equipment',async()=>{
 let release,calls=0;const {page}=setup({listExercises:(app,q)=>{calls++;assert.equal(q.body_part,'chest');assert.equal(q.equipment,'barbell');return new Promise(r=>release=r)}})
 page._sequence=1;page.setData({bodyPart:'back',activeBodyPart:'back',selectedLabel:'背',equipment:'barbell',list:[{id:'b'}],total:1,filters:{body_parts:[{value:'back',label:'背'},{value:'chest',label:'胸'}]}})
 const next=page.loadMore();page.loadMore();assert.equal(calls,1);release({data:[{id:'c'}],total:1});await next
 assert.equal(page.data.sectionHistory[0].list[0].id,'b');assert.equal(page.data.list[0].id,'c');assert.equal(page.data.bodyPart,'chest');assert.equal(page.data.activeBodyPart,'back')
 page.onBodyPart({currentTarget:{dataset:{v:'back'}}});assert.equal(page.data.resultsInto,'section-0');assert.equal(calls,1)
})
test('continuation failure retries the same category and search never expands across categories',async()=>{
 let fail=true;const {page}=setup({listExercises:async()=>{if(fail)throw Error('断网');return {data:[],total:0}}})
 page._sequence=1;page.setData({bodyPart:'back',selectedLabel:'背',list:[],total:0,filters:{body_parts:[{value:'back',label:'背'},{value:'chest',label:'胸'}]}})
 await page.loadMore();assert.equal(page.data.bodyPart,'back');assert.equal(page.data.sectionHistory.length,0);fail=false;await page.onRetry();assert.equal(page.data.bodyPart,'chest');assert.equal(page.data.sectionHistory.length,1)
 page.setData({bodyPart:'back',q:'划船'});assert.equal(page.nextPart(),null)
})
test('visible section determines sidebar highlight in both scrolling directions',()=>{
 let top=-400;const query={select(){return this},selectAll(){return this},boundingClientRect(){return this},exec(cb){cb([{top:100,bottom:600},[{top,bottom:300},{top:top+500,bottom:1000}]])}}
 const {page}=setup({}, {createSelectorQuery:()=>query});page.setData({bodyPart:'chest',activeBodyPart:'back',sectionHistory:[{key:'back'}],filters:{body_parts:[{value:'back'},{value:'chest'}]}})
 page.onResultsScroll();assert.equal(page.data.activeBodyPart,'chest');assert.equal(page.data.sidebarInto,'body-nav-1')
 top=100;page._lastScrollMeasure=0;page.onResultsScroll();assert.equal(page.data.activeBodyPart,'back')
})
