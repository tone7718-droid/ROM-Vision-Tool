import {JOINTS,STORE,LEGACY_STORE,MIN_FPS,Measurement,angle3,clinicalAngle,assessPose,loadRecordsDetailed,writeRecords,makeRecord,comparable,parseBackup,mergeRecords,csv} from './core.js';
const $=id=>document.getElementById(id);
const video=$('video'),canvas=$('canvas'),ctx=canvas.getContext('2d');
const measurement=new Measurement();
// MediaPipe 코드·WASM·모델은 이 저장소의 vendor/ 에서 불러옵니다(외부 CDN 미사용).
const VENDOR=new URL('./vendor/mediapipe/',import.meta.url).href;
const GAUGE_EMPTY=100;
let camera=null,landmarker=null,drawing=null,PoseLandmarker=null,running=false,starting=false,delegate='';
let generation=0,raf=0,lastVideoTime=-1,facing='user',fpsT=0,fpsN=0,fps=null,storageFault=false,legacySkipped=0;
let liveContext=null;
const fields=['jointSelect','patientId','posture','measureMode','targetAngle'];
function context() {
  const c={patient:$('patientId').value.trim(),posture:$('posture').value,mode:$('measureMode').value,target:Number($('targetAngle').value)};
  if(!c.patient || c.patient.length>80 || !Number.isFinite(c.target) || c.target<1 || c.target>180) throw new Error('환자 식별번호와 1~180°의 목표를 입력하세요.');
  return c;
}
const closedModels=new WeakSet();
function closeModel(model) { if(model && !closedModels.has(model)){closedModels.add(model);model.close();} }
let acceptedFields=Object.fromEntries(fields.map(k=>[k,$(k).value]));
// 매 프레임 호출되므로 내용이 바뀔 때만 DOM을 갱신합니다(화면 낭독기 반복 낭독 방지).
const shown=new Map();
function setText(id,text) { if(shown.get(id)!==text){shown.set(id,text);$(id).textContent=text;} }
function feedback(message,warn=false) {
  const className='feedback'+(warn?' warn':'');
  if(shown.get('feedback')===message && shown.get('feedback.class')===className) return;
  shown.set('feedback',message);shown.set('feedback.class',className);
  $('feedback').textContent=message; $('feedback').className=className;
}
function setGauge(angle) {
  setText('angleNum',angle===null?'—':String(Math.round(angle)));
  $('gaugeArc').style.strokeDashoffset=angle===null?GAUGE_EMPTY:GAUGE_EMPTY*(1-angle/180);
}
function read() {
  try {
    const detail=loadRecordsDetailed(localStorage); storageFault=false; legacySkipped=detail.legacySkipped;
    $('rawBtn').hidden=true; return detail.records;
  } catch(e) {
    storageFault=true; $('rawBtn').hidden=false;
    $('historyNotice').textContent='기록 읽기 실패: '+e.message+' 기존 데이터 보호를 위해 저장과 복원을 중단합니다. "손상된 원본 다운로드"로 데이터를 보관하세요.';
    return [];
  }
}
function persist(records) {
  if(storageFault) { alert('기존 기록을 읽을 수 없어 덮어쓰지 않습니다. 브라우저 저장 공간을 확인하세요.'); return false; }
  try { writeRecords(localStorage,records); return true; }
  catch(e) { alert('저장 실패: '+e.message+'\n현재 측정값을 유지합니다. JSON 백업 또는 CSV 내보내기를 사용하세요.'); return false; }
}
function reset() {
  measurement.reset(); setGauge(null);
  for(const id of ['minV','maxV','romV']) setText(id,'—');
  $('romFill').style.width='0%'; setText('romPct','0%');
  setText('extensionInfo','끝범위에서 각각 0.6초 이상 유지하세요.');
  $('summaryBox').style.display='none';
  feedback('두 끝범위를 각각 0.6초 이상 유지하세요. 통증 없는 허용 범위 안에서 측정하세요.');
}
function labels() {
  const J=JOINTS[$('jointSelect').value];
  $('jointGuide').textContent=J.guide;
  $('angleLabel').textContent=J.kind==='abduction'?'몸통–위팔 외전각 (내림 ≈ 0°)':'굴곡각 (펴짐 ≈ 0°)';
  $('romTarget').textContent='개별 목표 '+$('targetAngle').value+'°';
}
for(const id of fields) $(id).addEventListener('change',()=>{
  if(measurement.session.frames && !confirm('측정 조건을 바꾸면 저장하지 않은 현재 측정이 초기화됩니다. 계속할까요?')) {
    for(const k of fields) $(k).value=acceptedFields[k]; return;
  }
  if(id==='jointSelect') $('targetAngle').value=JOINTS[$('jointSelect').value].target;
  try { context(); } catch(e) { alert(e.message); for(const k of fields) $(k).value=acceptedFields[k]; return; }
  acceptedFields=Object.fromEntries(fields.map(k=>[k,$(k).value])); reset(); labels(); renderHistory();
});
function lockFields(locked) { for(const id of fields) $(id).disabled=locked; }
$('resetBtn').onclick=()=>{if(!measurement.session.frames || confirm('저장하지 않은 현재 측정을 초기화할까요?')) reset();};
$('saveBtn').onclick=()=>{
  try {
    const record=makeRecord(measurement,context(),$('jointSelect').value,crypto.randomUUID());
    const records=read(); if(!persist([...records,record])) return;
    reset(); renderHistory(); feedback('세션이 저장되었습니다. 동일한 조건의 기록끼리 추세를 비교합니다.');
  } catch(e) { alert(e.message); }
};
function download(content,name,type) {
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('csvBtn').onclick=()=>{
  const records=read();
  if(storageFault){alert('기존 기록을 읽을 수 없어 CSV를 만들 수 없습니다. "손상된 원본 다운로드"로 원본을 보관하세요.');return;}
  if(!records.length){alert('내보낼 기록이 없습니다.');return;}
  download(csv(records),'rom_records.csv','text/csv;charset=utf-8');
};
$('backupBtn').onclick=()=>{const records=read();if(storageFault)return;download(JSON.stringify({schema:'romvision',version:2,exportedAt:new Date().toISOString(),records},null,2),'rom_backup.json','application/json');};
// 손상된 저장 데이터를 해석하지 않고 그대로 내려받아 구조할 수 있게 합니다.
$('rawBtn').onclick=()=>{
  const raw={schema:'romvision-raw',exportedAt:new Date().toISOString(),[STORE]:localStorage.getItem(STORE),[LEGACY_STORE]:localStorage.getItem(LEGACY_STORE)};
  download(JSON.stringify(raw,null,2),'rom_raw_storage.json','application/json');
};
$('restoreBtn').onclick=()=>{$('restoreFile').click();};
$('restoreFile').onchange=async()=>{
  const file=$('restoreFile').files[0]; $('restoreFile').value=''; if(!file)return;
  try {
    if(file.size>10*1024*1024)throw new Error('백업은 10MB 이하만 지원합니다.');
    const incoming=parseBackup(await file.text()),existing=read();
    if(storageFault)return;
    const merged=mergeRecords(existing,incoming),count=merged.length-existing.length;
    if(!count){alert('추가할 새 기록이 없습니다.');return;}
    if(!confirm(`${count}개 기록을 추가합니다. 기존 기록은 유지합니다. 복원할까요?`))return;
    // Re-read after confirmation to preserve concurrent writes from other tabs.
    const latest=read(); if(storageFault)return;
    if(persist(mergeRecords(latest,incoming))){renderHistory();feedback('백업 복원이 완료되었습니다.');}
  }catch(e){alert('복원 실패: '+e.message+'\n기존 기록은 변경하지 않았습니다.');}
};
function sameRecords() { return comparable(read(),$('jointSelect').value,context()); }
function renderHistory() {
  const all=read(); let records=[];
  try {records=comparable(all,$('jointSelect').value,context());}catch{}
  $('histList').replaceChildren(); $('trend').replaceChildren(); $('summaryBox').style.display='none';
  if(!storageFault) {
    const skipped=legacySkipped?` 읽을 수 없는 기존 기록 ${legacySkipped}개는 제외했으며 원본은 브라우저에 그대로 남아 있습니다.`:'';
    $('historyNotice').textContent=`전체 ${all.length}개 · 동일 조건 ${records.length}개 · 기존 내각 기록 ${all.filter(r=>r.angleKind==='inner-v1').length}개는 백업·CSV에 보존하고 추세에서는 제외합니다.`+skipped;
  }
  for(const r of records.slice(-5).reverse()) {
    const li=document.createElement('li'),text=document.createElement('span'),button=document.createElement('button');
    text.textContent=`${new Date(r.t).toLocaleString('ko-KR')} · ${r.min}–${r.max}° / 범위 ${r.rom}°`;
    button.className='x';button.textContent='×';button.setAttribute('aria-label','해당 측정 기록 삭제');
    button.onclick=()=>{if(!confirm('이 측정 기록을 삭제할까요?'))return;const latest=read();if(persist(latest.filter(x=>x.id!==r.id)))renderHistory();};
    li.append(text,button);$('histList').append(li);
  }
  const ns='http://www.w3.org/2000/svg';
  function svg(tag,attrs,text) { const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;$('trend').append(el); }
  if(!records.length) {svg('text',{x:140,y:50,'text-anchor':'middle','font-size':11,fill:'#8FA3A0'},'동일 조건의 저장 기록이 없습니다');return;}
  const points=records.slice(-12),target=context().target,max=Math.max(target,...points.map(r=>r.rom))*1.08;
  const X=i=>points.length===1?140:20+i*240/(points.length-1),Y=v=>80-v/max*68;
  svg('line',{x1:20,y1:Y(target),x2:260,y2:Y(target),stroke:'#D8E0DE','stroke-dasharray':'3 3'});
  if(points.length>1)svg('polyline',{fill:'none',stroke:'#0E8A6D','stroke-width':2,points:points.map((r,i)=>`${X(i)},${Y(r.rom)}`).join(' ')});
  points.forEach((r,i)=>{svg('circle',{cx:X(i),cy:Y(r.rom),r:3,fill:'#0E8A6D'});svg('text',{x:X(i),y:Y(r.rom)-6,'text-anchor':'middle','font-size':8},r.rom);});
}
$('summaryBtn').onclick=()=>{
  let records;try{records=sameRecords();}catch(e){alert(e.message);return;}
  if(records.length<2){alert('동일한 환자·관절·자세·방식·목표의 기록이 2회 이상 필요합니다.');return;}
  const last=records.at(-1),prev=records.at(-2),difference=Math.round((last.rom-prev.rom)*10)/10;
  $('summaryBox').textContent=`동일 조건 ${records.length}회 기록\n최근 움직인 범위 ${last.rom}° (${last.min}–${last.max}°), 직전 대비 ${difference>0?'+':''}${difference}°.\n몸통 자세 확인 신호: ${last.c===null?'이 관절 또는 자세에서는 미지원':`유효 프레임의 ${last.c}% (직전 ${prev.c??'미지원'}%)`}. 이 값은 보상 움직임의 임상 판정이 아닙니다.\n\n변화에는 촬영 위치·추적 오차가 포함될 수 있습니다. 오차 범위가 검증되지 않아 작은 차이를 회복 또는 악화로 판정하지 않습니다. 같은 촬영 조건과 측정 방법을 유지하세요.\n규칙 기반 요약이며 외부 AI API를 사용하지 않습니다.`;
  $('summaryBox').style.display='block';
};
function cameraButtons() {
  $('stopBtn').disabled=!running&&!starting; $('switchBtn').disabled=!running||starting;
  $('startBtn').disabled=starting; $('startBtn').textContent=starting?'카메라 준비 중…':'카메라 시작';
  lockFields(running||starting);
}
function stopCamera() {
  generation++;running=false;starting=false;cancelAnimationFrame(raf);measurement.loseTracking();
  camera?.getTracks().forEach(t=>t.stop());camera=null;video.pause();video.srcObject=null;
  closeModel(landmarker);landmarker=null;drawing=null;lastVideoTime=-1;fps=null;liveContext=null;
  $('placeholder').style.display='flex';$('hud').style.display='none';$('led').classList.remove('on');$('statusText').textContent='카메라 중지';
  setGauge(null);
  cameraButtons();
}
async function startCamera() {
  if(starting||running)return;
  let c;try{c=context();}catch(e){alert(e.message);return;}
  if(!navigator.mediaDevices?.getUserMedia){alert('카메라를 사용할 수 없습니다. HTTPS 또는 localhost에서 접속하세요.');return;}
  const token=++generation;starting=true;cameraButtons();$('statusText').textContent='모델 로딩';
  let pendingModel=null,pendingStream=null;
  try {
    const vision=await import(VENDOR+'vision_bundle.mjs');
    if(token!==generation)return;
    PoseLandmarker=vision.PoseLandmarker;
    const files=await vision.FilesetResolver.forVisionTasks(VENDOR+'wasm');
    if(token!==generation)return;
    const options={baseOptions:{modelAssetPath:VENDOR+'pose_landmarker_full.task',delegate:'GPU'},runningMode:'VIDEO',numPoses:1};
    try{pendingModel=await PoseLandmarker.createFromOptions(files,options);}catch{options.baseOptions.delegate='CPU';pendingModel=await PoseLandmarker.createFromOptions(files,options);}
    if(token!==generation){closeModel(pendingModel);return;}
    pendingStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:960},height:{ideal:720},facingMode:{ideal:facing}}});
    if(token!==generation){pendingStream.getTracks().forEach(t=>t.stop());closeModel(pendingModel);return;}
    camera=pendingStream;landmarker=pendingModel;video.srcObject=camera;
    await video.play();
    if(token!==generation)return;
    if(!video.videoWidth||!video.videoHeight)throw new Error('카메라 영상 크기를 확인할 수 없습니다.');
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    drawing=new vision.DrawingUtils(ctx);delegate=options.baseOptions.delegate;liveContext=c;
    running=true;starting=false;lastVideoTime=-1;fpsT=performance.now();fpsN=0;fps=null;measurement.loseTracking();
    $('placeholder').style.display='none';$('hud').style.display='block';$('led').classList.add('on');$('statusText').textContent='측정 중 · 기기 내 처리';
    cameraButtons();raf=requestAnimationFrame(loop);
  }catch(e){
    pendingStream?.getTracks().forEach(t=>t.stop());
    if(token!==generation){if(pendingModel && pendingModel!==landmarker)closeModel(pendingModel);return;}
    if(pendingModel && pendingModel!==landmarker)closeModel(pendingModel);
    stopCamera();$('statusText').textContent='시작 실패';alert('시작 실패: '+e.message+'\n카메라 권한과 HTTPS 접속을 확인하세요.');
  }
}
$('startBtn').onclick=startCamera;
$('stopBtn').onclick=()=>{stopCamera();feedback('카메라를 중지했습니다. 현재 측정값은 유지되어 저장할 수 있습니다.');};
$('switchBtn').onclick=async()=>{
  if(measurement.session.frames && !confirm('카메라 전환 시 현재 측정을 초기화합니다. 먼저 저장하려면 취소하세요. 전환할까요?'))return;
  facing=facing==='user'?'environment':'user';stopCamera();reset();await startCamera();
};
window.addEventListener('pagehide',stopCamera);
document.addEventListener('visibilitychange',()=>{if(document.hidden && (running||starting)){stopCamera();feedback('화면을 벗어나 카메라를 중지했습니다. 다시 시작할 수 있습니다.');}});
window.addEventListener('storage',renderHistory);
function lowFpsWarning() {
  return fps!==null && fps<MIN_FPS ? `기기 처리 속도(${fps} fps)가 너무 낮아 끝범위를 기록할 수 없습니다. 다른 앱을 닫거나 성능이 더 좋은 기기·브라우저를 사용하세요.` : null;
}
function showAngle(result,pose,J) {
  const slow=lowFpsWarning();
  if(result.angle===null) {
    setGauge(null);
    feedback(slow||pose.warning||'추적을 다시 확인하고 있습니다. 관절이 잘 보이도록 천천히 움직이세요.',true);return;
  }
  setGauge(result.angle);
  const s=measurement.session;
  if(Number.isFinite(s.min)) {
    setText('minV',s.min.toFixed(1)+'°');setText('maxV',s.max.toFixed(1)+'°');
    const range=s.max-s.min;setText('romV',range.toFixed(1)+'°');
    const pct=Math.min(100,range/liveContext.target*100);$('romFill').style.width=pct+'%';setText('romPct',Math.round(pct)+'%');
    setText('extensionInfo',J.showExtension?`최소 굴곡각 ${s.min.toFixed(1)}° — 신전 제한 참고값 (과신전 구분 불가)`:'최소·최대 측정각의 차이를 움직인 범위로 기록합니다.');
  }
  const warning=slow||pose.warning;
  feedback(warning||(result.accepted?'끝범위가 확인되었습니다. 반대 끝범위에서도 0.6초 이상 유지하세요.':'천천히 움직이고 끝범위에서 0.6초 이상 유지하세요.'),!!warning);
}
function draw(res,time) {
  ctx.save();ctx.clearRect(0,0,canvas.width,canvas.height);
  if($('mirror').checked){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  const lm=res.landmarks?.[0],J=JOINTS[$('jointSelect').value];
  const pose=assessPose(lm,J,canvas.width,canvas.height,liveContext.posture);
  const points=J.pts.map(i=>lm?.[i]);
  const raw=pose.valid?clinicalAngle(angle3(...points,canvas.width,canvas.height),J):null;
  const result=measurement.sample(raw,time,pose.valid,pose.comp);
  if(lm) drawing.drawConnectors(lm,PoseLandmarker.POSE_CONNECTIONS,{color:'rgba(255,255,255,.35)',lineWidth:2});
  if(result.angle!==null && pose.valid) {
    ctx.strokeStyle=pose.comp?'#E8B14C':'#19D3A5';ctx.lineWidth=4;
    ctx.beginPath();points.forEach((p,i)=>{const x=p.x*canvas.width,y=p.y*canvas.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
    for(const p of points){ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,6,0,2*Math.PI);ctx.stroke();}
  }
  ctx.restore();showAngle(result,pose,J);
}
function loop(time) {
  if(!running)return;
  try {
    if(video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;draw(landmarker.detectForVideo(video,time),time);fpsN++;}
    if(time-fpsT>=1000){
      fps=Math.round(fpsN*1000/(time-fpsT));fpsN=0;fpsT=time;
      setText('hud',`${fps} fps · ${delegate} · ${facing==='user'?'전면 요청':'후면 요청'} · 기기 내 처리`+(fps<MIN_FPS?' · 속도 부족':''));
    }
    raf=requestAnimationFrame(loop);
  }catch(e){stopCamera();feedback('측정이 중지되었습니다: '+e.message+' 현재 측정값은 유지합니다.',true);}
}
labels();renderHistory();cameraButtons();
