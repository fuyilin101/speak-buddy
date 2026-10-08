const fs=require('fs');
const p='src/main.tsx';let s=fs.readFileSync(p,'utf8');const a=s.indexOf('  function cancelListening()');const b=s.indexOf('  useEffect(()=>{',a);
s=s.slice(0,a)+`  const recorderRef=useRef<MediaRecorder|null>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const recordingGeneration=useRef(0);
  function cancelListening(){
    recordingGeneration.current++;holdListeningRef.current=false;
    window.clearTimeout(restartTimerRef.current);
    const recorder=recorderRef.current;recorderRef.current=null;
    if(recorder?.state==='recording'){recorder.onstop=null;recorder.stop()}
    streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;
    setListening(false);setVoiceStatus('');
  }
  async function startListening(){
    if(holdListeningRef.current)return;
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
      setVoiceStatus('此浏览器不支持网页录音，请在系统浏览器打开');return;
    }
    const generation=++recordingGeneration.current;
    holdListeningRef.current=true;setListening(true);setVoiceStatus('请允许麦克风权限…');
    audioRef.current?.pause();
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      if(generation!==recordingGeneration.current||!holdListeningRef.current){stream.getTracks().forEach(t=>t.stop());return}
      streamRef.current=stream;
      const mode=conversationMode;
      const record=()=>{
        if(!holdListeningRef.current||generation!==recordingGeneration.current)return;
        const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
        const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
        recorderRef.current=recorder;const chunks:BlobPart[]=[];
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
        recorder.onstop=async()=>{
          recorderRef.current=null;window.clearTimeout(restartTimerRef.current);
          if(generation!==recordingGeneration.current)return;
          try{
            const blob=new Blob(chunks,{type:recorder.mimeType});
            if(blob.size<500){setVoiceStatus('录音太短，请再试一次');return}
            setVoiceStatus('正在识别语音…');
            const audioDataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob)});
            const response=await fetch('/api/voice',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({audioDataUrl})});
            const data=await response.json();if(!response.ok)throw new Error(data.error||'语音识别失败');
            if(generation!==recordingGeneration.current)return;
            if(data.text?.trim()){setVoiceStatus('正在回复…');await sendVoiceRef.current(data.text)}else setVoiceStatus('没有听清，请再说一次');
          }catch{setVoiceStatus('语音识别失败，请重试')}
          finally{
            if(mode==='free'&&holdListeningRef.current&&generation===recordingGeneration.current){
              // Pause recording while the companion reply audio is being prepared/played.
              restartTimerRef.current=window.setTimeout(()=>{const resume=()=>{if(audioRef.current&&!audioRef.current.paused){restartTimerRef.current=window.setTimeout(resume,300)}else record()};resume()},4000);
            }else{stream.getTracks().forEach(t=>t.stop());streamRef.current=null;setListening(false)}
          }
        };
        recorder.start();setVoiceStatus(mode==='turn'?'正在录音，松开发送':'正在录音，每 6 秒识别一句');
        restartTimerRef.current=window.setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},mode==='free'?6000:30000);
      };record();
    }catch{holdListeningRef.current=false;setListening(false);setVoiceStatus('无法访问麦克风，请检查权限或换系统浏览器')}
  }
  function stopListening(){holdListeningRef.current=false;window.clearTimeout(restartTimerRef.current);setListening(false);const r=recorderRef.current;if(r?.state==='recording')r.stop();else{recordingGeneration.current++;streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null}}
  function toggleFreeListening(){if(holdListeningRef.current)stopListening();else void startListening()}
`+s.slice(b);fs.writeFileSync(p,s);
const w='worker/index.ts';s=fs.readFileSync(w,'utf8');const marker="if(request.method==='POST'&&url.pathname==='/api/setup')";
s=s.replace(marker,`if(request.method==='POST'&&url.pathname==='/api/voice'){
 if(Number(request.headers.get('content-length')||0)>6000000)return json({error:'录音过大'},413);
 const body=await request.json() as {audioDataUrl?:string};
 if(typeof body.audioDataUrl!=='string'||!/^data:audio\\//.test(body.audioDataUrl)||body.audioDataUrl.length>6000000)return json({error:'录音格式或大小不正确'},400);
 if(!env.AI_GATEWAY_TOKEN||!env.AI_GATEWAY_URL)return json({error:'语音服务未配置'},503);
 try{const response=await fetch(env.AI_GATEWAY_URL,{method:'POST',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json',authorization:'Bearer '+env.AI_GATEWAY_TOKEN},body:JSON.stringify({model:'qwen3-asr-flash',messages:[{role:'user',content:[{type:'input_audio',input_audio:{data:body.audioDataUrl}}]}],stream:false,asr_options:{enable_itn:false}})});
 if(!response.ok){console.error('ASR upstream status',response.status);return json({error:'百炼语音识别暂时不可用'},502)}
 const data=await response.json() as any;const text=data.choices?.[0]?.message?.content;
 if(typeof text!=='string')return json({error:'没有有效识别结果'},502);
 return json({text});}catch{return json({error:'语音识别超时或连接失败'},502)}
 }`+marker);fs.writeFileSync(w,s);
