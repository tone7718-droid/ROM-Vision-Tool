export const JOINTS = {
  kneeR: {pts:[24,26,28], target:135, name:'무릎(우)', view:'side', kind:'flexion', guide:'오른쪽 측면을 촬영하고 무릎을 굽혔다 펴세요.'},
  kneeL: {pts:[23,25,27], target:135, name:'무릎(좌)', view:'side', kind:'flexion', guide:'왼쪽 측면을 촬영하고 무릎을 굽혔다 펴세요.'},
  elbowR: {pts:[12,14,16], target:145, name:'팔꿈치(우)', view:'side', kind:'flexion', guide:'오른팔의 운동면을 카메라와 평행하게 두고 굽혔다 펴세요.'},
  elbowL: {pts:[11,13,15], target:145, name:'팔꿈치(좌)', view:'side', kind:'flexion', guide:'왼팔의 운동면을 카메라와 평행하게 두고 굽혔다 펴세요.'},
  shoulderR: {pts:[24,12,14], target:165, name:'어깨 외전(우)', view:'front', kind:'abduction', guide:'정면에서 촬영하며 팔을 옆으로 들어 올리세요. 앞으로 드는 굴곡은 이 항목에서 측정하지 않습니다.'},
  shoulderL: {pts:[23,11,13], target:165, name:'어깨 외전(좌)', view:'front', kind:'abduction', guide:'정면에서 촬영하며 팔을 옆으로 들어 올리세요. 앞으로 드는 굴곡은 이 항목에서 측정하지 않습니다.'},
  hipR: {pts:[12,24,26], target:115, name:'고관절 굴곡(우)', view:'side', kind:'flexion', guide:'오른쪽 측면에서 무릎을 들어 올리세요. 몸통–허벅지의 근사각이며 골반 움직임을 분리하지 못합니다.'},
  hipL: {pts:[11,23,25], target:115, name:'고관절 굴곡(좌)', view:'side', kind:'flexion', guide:'왼쪽 측면에서 무릎을 들어 올리세요. 몸통–허벅지의 근사각이며 골반 움직임을 분리하지 못합니다.'},
};
export const STORE = 'romvision_records_v2';
export const LEGACY_STORE = 'romvision_records_v1';
export const HOLD_MS = 600;
export function angle3(a,b,c,width,height) {
  if (![a,b,c].every(p=>p && Number.isFinite(p.x) && Number.isFinite(p.y)) || !(width>0 && height>0)) return null;
  const ux=(a.x-b.x)*width, uy=(a.y-b.y)*height;
  const vx=(c.x-b.x)*width, vy=(c.y-b.y)*height;
  const m=Math.hypot(ux,uy)*Math.hypot(vx,vy);
  if(m<1e-6) return null;
  return Math.acos(Math.max(-1,Math.min(1,(ux*vx+uy*vy)/m)))*180/Math.PI;
}
export function clinicalAngle(inner,joint) {
  return inner===null ? null : joint.kind==='abduction' ? inner : 180-inner;
}
export function newSession() { return {min:Infinity,max:-Infinity,frames:0,comp:0,holds:0}; }
export class Measurement {
  constructor() { this.reset(); }
  reset() { this.session=newSession(); this.loseTracking(); }
  loseTracking() { this.smooth=null; this.lastRaw=null; this.lastTime=null; this.candidate=null; this.window=[]; }
  sample(raw,time,valid=true,comp=false) {
    if(!valid || !Number.isFinite(raw) || raw<0 || raw>180) { this.loseTracking(); return {angle:null,accepted:false}; }
    if(this.lastTime!==null && (time-this.lastTime>250 || time<=this.lastTime)) this.loseTracking();
    this.lastTime=time;
    // A sudden change needs three consistent observations before re-acquisition.
    if(this.lastRaw!==null && Math.abs(raw-this.lastRaw)>35) {
      if(!this.candidate || Math.abs(raw-this.candidate.value)>5) this.candidate={value:raw,count:1};
      else this.candidate.count++;
      if(this.candidate.count<3) { this.window=[]; return {angle:null,accepted:false}; }
      this.smooth=null; this.window=[];
    }
    this.candidate=null; this.lastRaw=raw;
    this.smooth=this.smooth===null ? raw : this.smooth*.7+raw*.3;
    this.session.frames++; if(comp) this.session.comp++;
    this.window.push({angle:this.smooth,time});
    // Require a continuously observed endpoint within a 4° band for 0.6 seconds.
    while(this.window.length && (time-this.window[0].time>900 || Math.abs(this.smooth-this.window[0].angle)>4)) this.window.shift();
    const values=this.window.map(x=>x.angle);
    const stable=this.window.length>=5 && time-this.window[0].time>=HOLD_MS && Math.max(...values)-Math.min(...values)<=4;
    if(stable) {
      const sorted=values.slice().sort((a,b)=>a-b), endpoint=sorted[Math.floor(sorted.length/2)];
      this.session.min=Math.min(this.session.min,endpoint);
      this.session.max=Math.max(this.session.max,endpoint); this.session.holds++;
    }
    return {angle:this.smooth,accepted:stable};
  }
}
export function assessPose(lm,joint,width,height,posture='standing') {
  const required=[...new Set([...joint.pts,11,12,23,24])];
  if(!required.every(i=>lm?.[i] && Number.isFinite(lm[i].x) && Number.isFinite(lm[i].y) && lm[i].x>=0 && lm[i].x<=1 && lm[i].y>=0 && lm[i].y<=1 && (lm[i].visibility??0)>=.65))
    return {valid:false,warning:'관절과 몸통이 화면에 충분히 보이도록 위치를 조정하세요.',comp:false};
  const shX=(lm[11].x+lm[12].x)/2, shY=(lm[11].y+lm[12].y)/2;
  const hpX=(lm[23].x+lm[24].x)/2, hpY=(lm[23].y+lm[24].y)/2;
  const tx=(hpX-shX)*width,ty=(hpY-shY)*height;
  const torso=Math.hypot(tx,ty);
  if(torso<10) return {valid:false,warning:'몸통이 너무 작거나 가려져 있습니다.',comp:false};
  const sx=(lm[11].x-lm[12].x)*width,sy=(lm[11].y-lm[12].y)*height;
  const ratio=Math.abs(sx*ty-sy*tx)/(torso*torso);
  if(joint.view==='side' && ratio>.45) return {valid:false,warning:'운동면이 카메라와 평행하도록 측면을 촬영하세요.',comp:false};
  if(joint.view==='front' && ratio<.25) return {valid:false,warning:'어깨 외전은 정면에서 촬영하세요.',comp:false};
  const tilt=Math.abs(Math.atan2((shX-hpX)*width,(hpY-shY)*height)*180/Math.PI);
  const upright=['standing','sitting'].includes(posture);
  const comp=upright && ((joint.kind==='abduction' && tilt>12) || (joint.name.startsWith('고관절') && tilt>15));
  return {valid:true,comp,warning:comp?'몸통 기울임이 감지되었습니다. 촬영 자세를 확인하세요.':null};
}
function finiteRange(v,min,max) { return typeof v==='number' && Number.isFinite(v) && v>=min && v<=max; }
function validContext(c) {
  return c && typeof c.patient==='string' && c.patient.length>0 && c.patient.length<=80 && typeof c.posture==='string' && c.posture.length>0 && c.posture.length<=80 && ['active','passive'].includes(c.mode) && finiteRange(c.target,1,180);
}
export function validateRecords(records) {
  if(!Array.isArray(records) || records.length>10000) throw new Error('기록 배열이 올바르지 않습니다(최대 10,000개).');
  const ids=new Set();
  for(const r of records) {
    if(!r || typeof r.id!=='string' || !r.id || r.id.length>100 || ids.has(r.id) || !JOINTS[r.j] || !finiteRange(r.t,0,8640000000000000) || !finiteRange(r.min,0,180) || !finiteRange(r.max,r.min,180) || !finiteRange(r.rom,0,180) || Math.abs((r.max-r.min)-r.rom)>1.1 || !(r.c===null || finiteRange(r.c,0,100)) || !['clinical-v2','inner-v1'].includes(r.angleKind)) throw new Error('손상되거나 중복된 측정 기록이 있습니다.');
    if(r.angleKind==='clinical-v2' && (!validContext(r.context) || !Number.isInteger(r.frames) || r.frames<1)) throw new Error('측정 조건이 올바르지 않습니다.');
    ids.add(r.id);
  }
  return records;
}
export function migrateLegacy(records) {
  if(!Array.isArray(records)) throw new Error('기존 기록을 읽을 수 없습니다.');
  return validateRecords(records.map((r,i)=>({...r,c:r.c??0,id:`legacy-${r.t}-${i}`,angleKind:'inner-v1'})));
}
export function loadRecords(storage) {
  const current=storage.getItem(STORE);
  if(current!==null) return validateRecords(JSON.parse(current));
  const legacy=storage.getItem(LEGACY_STORE);
  return legacy===null ? [] : migrateLegacy(JSON.parse(legacy));
}
export function writeRecords(storage,records) { validateRecords(records); storage.setItem(STORE,JSON.stringify(records)); }
export function makeRecord(measurement,context,j,id,t=Date.now()) {
  const s=measurement.session;
  if(!Number.isFinite(s.min) || !Number.isFinite(s.max) || s.max-s.min<5) throw new Error('두 끝범위에서 각각 0.6초 이상 유지하고 5° 이상의 범위를 측정하세요.');
  const min=Math.round(s.min*10)/10,max=Math.round(s.max*10)/10;
  const record={id,t,j,min,max,rom:Math.round((max-min)*10)/10,c:(['standing','sitting'].includes(context.posture) && (JOINTS[j].kind==='abduction' || JOINTS[j].name.startsWith('고관절'))) ? Math.round(s.comp/s.frames*100) : null,frames:s.frames,angleKind:'clinical-v2',context:{...context}};
  validateRecords([record]); return record;
}
export function comparable(records,key,context) {
  return records.filter(r=>r.angleKind==='clinical-v2' && r.j===key && ['patient','posture','mode','target'].every(k=>r.context[k]===context[k])).sort((a,b)=>a.t-b.t);
}
export function parseBackup(text) {
  const data=JSON.parse(text);
  if(data.schema!=='romvision' || data.version!==2) throw new Error('ROM Vision v2 백업 파일이 아닙니다.');
  return validateRecords(data.records);
}
export function mergeRecords(existing,incoming) {
  validateRecords(existing); validateRecords(incoming);
  const map=new Map(existing.map(r=>[r.id,r]));
  for(const r of incoming) {
    if(map.has(r.id) && JSON.stringify(map.get(r.id))!==JSON.stringify(r)) throw new Error('같은 ID에 서로 다른 기록이 있습니다. 복원을 중단했습니다.');
    map.set(r.id,r);
  }
  return validateRecords([...map.values()].sort((a,b)=>a.t-b.t));
}
export function csv(records) {
  const cell=v=>'"'+String(v??'').replaceAll('"','""').replace(/^[=+@-]/,"'$&")+'"';
  const header=['date','patient_id','joint','posture','mode','target','angle_kind','min','max','rom','posture_flag_pct'];
  return '\uFEFF'+[header,...records.map(r=>[new Date(r.t).toISOString(),r.context?.patient??'미분류(기존)',JOINTS[r.j].name,r.context?.posture,r.context?.mode,r.context?.target,r.angleKind,r.min,r.max,r.rom,r.c])].map(row=>row.map(cell).join(',')).join('\r\n');
}
