// Frontend recording controls only. ASR payloads and providers remain unchanged.
const MOCK_DEMO = '深蹲 60公斤 10次 4组'
let owner = null
function createSpeechComposer(hooks) {
  const h=hooks||{}, lease={}
  let mode='none', recorder=null, manager=null, baseText='', recording=false, started=false, paused=false, stopping=false, destroyed=false
  const current=()=>!destroyed && owner===lease
  function startedNow(){if(!current()||started)return;started=true;h.onStart&&h.onStart({mode,canPause:mode==='recorder'&&typeof recorder.pause==='function'&&typeof recorder.resume==='function'})}
  function end(error){if(!current())return;recording=false;paused=false;started=false;stopping=false;h.onEnd&&h.onEnd({mode,error:!!error});owner=null}
  function error(e){if(!current())return;h.onError&&h.onError(e||{message:'录音失败'});end(true)}
  function finish(piece){if(!current())return;h.onFinal&&h.onFinal(joinText(baseText,piece||''));end()}
  function init(){
    if(mode==='recorder' && recorder)return true
    try {
      if(typeof requirePlugin==='function'){
        const plugin=requirePlugin('WechatSI')
        if(plugin&&plugin.getRecordRecognitionManager){
          manager=plugin.getRecordRecognitionManager();mode='wechatSI'
          manager.onStart=startedNow
          manager.onRecognize=res=>{if(!current())return;startedNow();h.onPartial&&h.onPartial(joinText(baseText,res&&res.result))}
          manager.onStop=res=>{if(!current())return;finish(res&&res.result)}
          manager.onError=error
          return true
        }
      }
    }catch(_){}
    try {
      recorder=wx.getRecorderManager();mode='recorder'
      recorder.onStart&&recorder.onStart(startedNow)
      recorder.onPause&&recorder.onPause(()=>{if(!current())return;paused=true;h.onPause&&h.onPause()})
      recorder.onResume&&recorder.onResume(()=>{if(!current())return;paused=false;h.onResume&&h.onResume()})
      recorder.onInterruptionBegin&&recorder.onInterruptionBegin(()=>{if(!current())return;paused=true;h.onPause&&h.onPause({interrupted:true})})
      recorder.onStop(res=>{
        if(!current())return;recording=false;paused=false;started=false
        if(!res||!res.tempFilePath)return error({message:'未拿到录音文件，请重试或手填'})
        h.onProcessing&&h.onProcessing()
        if(h.onNeedAsr)h.onNeedAsr({tempFilePath:res.tempFilePath,baseText,finish,fail:error})
        else finish('')
      })
      recorder.onError(error)
      return true
    }catch(e){return false}
  }
  function start(text){
    if(destroyed||owner||recording)return false
    owner=lease;baseText=text||'';recording=true;started=false;paused=false;stopping=false
    if(!init()){error({message:'设备不支持录音',micDenied:true});return false}
    h.onRequest&&h.onRequest({mode})
    try {
      if(mode==='wechatSI')manager.start({duration:60000,lang:'zh_CN'})
      else recorder.start({duration:60000,sampleRate:16000,numberOfChannels:1,encodeBitRate:48000,format:'mp3'})
      return true
    }catch(e){error(e);return false}
  }
  function stop(){
    if(!current()||!recording||stopping)return false
    stopping=true;h.onStopping&&h.onStopping()
    try{(mode==='wechatSI'?manager:recorder).stop();return true}catch(e){error(e);return false}
  }
  function pause(){if(!current()||!started||paused||stopping||mode!=='recorder'||typeof recorder.pause!=='function')return false;try{recorder.pause();return true}catch(e){h.onError&&h.onError(e);return false}}
  function resume(){if(!current()||!paused||stopping||mode!=='recorder'||typeof recorder.resume!=='function')return false;try{recorder.resume();return true}catch(e){h.onError&&h.onError(e);return false}}
  function destroy(){const stopActive=current()&&recording;destroyed=true;if(owner===lease)owner=null;if(stopActive)try{(mode==='wechatSI'?manager:recorder).stop()}catch(_){} }
  return {start,stop,pause,resume,destroy,getMode:()=>mode,isRecording:()=>recording,MOCK_DEMO}
}

function joinText(base, piece) {
  const b = String(base || '')
  const p = String(piece || '')
  if (!p) return b
  if (!b) return p
  if (b.endsWith(p)) return b
  const needSpace = !/\s$/.test(b) && !/^[,.，。、\s]/.test(p)
  return b + (needSpace ? (/\n$/.test(b) ? '' : ' ') : '') + p
}

module.exports = { createSpeechComposer, MOCK_DEMO }
