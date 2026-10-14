// Only observation is injected. Download, Cache Storage, worker, ORT WASM,
// Supertonic inference, PCM processing and Web Audio are the production paths.
import { getNeuralEngine, neuralVoices } from '../../../src/js/readers/neural-voice/index.js';
import { requireRustUI } from '../../../src/js/rust-ui.js';

// The reader never builds an engine before its Rust UI module is in (the engine's decisions live there).
if (!await requireRustUI()) throw new Error('Rust UI is unavailable');

const engine = getNeuralEngine(),starts=[],events=[],workerRequests=[],workerMessages=[];
let context=null,activeId=null;
const NativeWorker=window.Worker;
let workers=0;
window.Worker=class extends NativeWorker {
  constructor(...args) {
    super(...args);workers++;
    const send=this.postMessage.bind(this);
    this.postMessage=(message,transfer)=>{
      workerRequests.push({ type:message.type,id:message.id,voice:message.voice,lang:message.lang,style:message.style,text:message.text,rate:message.rate });
      return send(message,transfer);
    };
    this.addEventListener('message',({data})=>workerMessages.push({ type:data.type,id:data.id,error:data.error,samples:data.pcm?.length,sampleRate:data.sampleRate }));
  }
};
const originalCreate=AudioContext.prototype.createBufferSource;
AudioContext.prototype.createBufferSource=function() {
  context=this;
  const source=originalCreate.call(this),start=source.start.bind(source);
  source.start=(when,...args)=>{
    starts.push({ id:activeId,when,now:this.currentTime,sampleRate:source.buffer.sampleRate,seconds:source.buffer.duration,data:Array.from(source.buffer.getChannelData(0)) });
    return start(when,...args);
  };
  return source;
};
window.addEventListener('inhouse-tts',({detail})=>events.push({ ...detail,at:performance.now(),ctxTime:context?.currentTime,latency:context?.outputLatency||context?.baseLatency||0 }));
let deviceCalls=0;
if(window.speechSynthesis)window.speechSynthesis.speak=()=>{deviceCalls++;throw new Error('System voice called in a natural voice test');};
window.InhouseSpeech={ speak:()=>{deviceCalls++;throw new Error('Android system voice called');} };
document.querySelector('#unlock').addEventListener('click',()=>engine.unlock());

function read(voiceId,text,rate=1,marks=[]) {
  const id=`supertonic-${voiceId}-${events.length}`;
  const from=events.length,first=starts.length,requests=workerRequests.length,messages=workerMessages.length;
  activeId=id;
  return new Promise(resolve=>{
    const handle=({detail})=>{
      if(detail.id!==id||!['done','error','interrupted'].includes(detail.type))return;
      window.removeEventListener('inhouse-tts',handle);
      resolve({ id,log:events.slice(from),starts:starts.slice(first),requests:workerRequests.slice(requests),messages:workerMessages.slice(messages),workers,deviceCalls,stats:{...engine.stats},audioState:context?.state });
    };
    window.addEventListener('inhouse-tts',handle);
    engine.speak({voiceId,text,rate,id,marks});
  });
}
window.supertonic={engine,voices:neuralVoices,read,starts,events,workerRequests,workerMessages,get workers(){return workers;}};

// The real reading integration, including its catalog refresh and text planner.
import { ReadingVoice } from '../../../src/js/readers/reading-voice.js';
import { loadNeural } from '../../../src/js/readers/neural-runtime.js';
const startReading=document.createElement('button');
startReading.id='play-reading';startReading.textContent='Play prepared reading';document.body.append(startReading);
let reading;
startReading.onclick=()=>{window.supertonic.playAt=performance.now();void reading.play();};
window.supertonic.prepareReading=async(voiceId,text,language)=>{
  reading?.stop();engine.stop();engine.core?.cache.clear();
  await loadNeural();
  reading=new ReadingVoice({language,location:{fraction:0},getSpeechText:async()=>text});
  reading.voice=voiceId;
  return reading.preparePlayback();
};
window.supertonic.stopReading=()=>reading?.stop();
