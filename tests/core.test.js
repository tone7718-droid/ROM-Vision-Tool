import test from 'node:test';
import assert from 'node:assert/strict';
import {JOINTS,Measurement,angle3,clinicalAngle,assessPose,STORE,LEGACY_STORE,loadRecords,loadRecordsDetailed,writeRecords,makeRecord,comparable,parseBackup,mergeRecords,csv} from '../core.js';
const context={patient:'P001',posture:'standing',mode:'active',target:135};
const record=(id='r1')=>({id,t:100,j:'kneeR',min:10,max:110,rom:100,c:0,frames:60,angleKind:'clinical-v2',context:{...context}});
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
function hold(m,a,start,comp=false){for(let t=start;t<=start+800;t+=40)m.sample(a,t,true,comp);}
test('pixel geometry is invariant across 4:3 and 16:9 camera aspect ratios',()=>{
  for(const [w,h] of [[960,720],[1920,1080],[720,960]]){
    const b={x:300/w,y:300/h},a={x:400/w,y:300/h},c={x:400/w,y:400/h};
    assert.ok(Math.abs(angle3(a,b,c,w,h)-45)<1e-9);
  }
  assert.equal(angle3({x:0,y:0},{x:0,y:0},{x:1,y:1},960,720),null);
});
test('joint definitions separate flexion from shoulder abduction',()=>{
  assert.equal(clinicalAngle(180,JOINTS.kneeR),0);assert.equal(clinicalAngle(45,JOINTS.elbowR),135);
  assert.equal(clinicalAngle(90,JOINTS.shoulderR),90);assert.equal(clinicalAngle(null,JOINTS.hipR),null);
});
test('moving samples alone cannot create endpoints or a saved session',()=>{
  const m=new Measurement();for(let i=0;i<25;i++)m.sample(i*5,i*40);
  assert.equal(m.session.min,Infinity);assert.throws(()=>makeRecord(m,context,'kneeR','r1'));
});
test('single-frame spike does not pollute stable endpoints',()=>{
  const m=new Measurement();hold(m,10,0);m.sample(150,840);hold(m,10,880);
  assert.ok(Math.abs(m.session.max-10)<.001);
});
test('reacquisition after occlusion resets smoothing and requires another hold',()=>{
  const m=new Measurement();hold(m,10,0);m.sample(null,840,false);
  assert.equal(m.sample(110,880).angle,110);assert.equal(m.session.max,10);
  hold(m,110,920);const r=makeRecord(m,context,'kneeR','r1');assert.equal(r.min,10);assert.equal(r.max,110);assert.equal(r.rom,100);
});
test('wrong-view frames never enter a session',()=>{
  const m=new Measurement();for(let t=0;t<1000;t+=40)m.sample(100,t,false);assert.equal(m.session.frames,0);
  const lm=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));
  lm[11]={x:.3,y:.2,visibility:1};lm[12]={x:.7,y:.2,visibility:1};lm[23]={x:.4,y:.6,visibility:1};lm[24]={x:.6,y:.6,visibility:1};
  assert.equal(assessPose(lm,JOINTS.kneeR,960,720).valid,false);
  assert.equal(assessPose(lm,JOINTS.shoulderR,960,720).valid,true);
  lm[14].visibility=.2;assert.equal(assessPose(lm,JOINTS.shoulderR,960,720).valid,false);
});
test('saving failure leaves measured endpoints available for retry',()=>{
  const m=new Measurement();hold(m,10,0);m.loseTracking();hold(m,110,1000);
  const r=makeRecord(m,context,'kneeR','r1');
  assert.throws(()=>writeRecords({setItem(){throw new Error('quota');}},[r]),/quota/);
  assert.equal(m.session.min,10);assert.equal(m.session.max,110);
  const storage=memory();writeRecords(storage,[r]);assert.deepEqual(loadRecords(storage),[r]);
});
test('legacy records survive migration and are excluded from clinical comparisons',()=>{
  const storage=memory();const original=JSON.stringify([{t:10,j:'kneeR',min:45,max:180,rom:135}]);storage.setItem(LEGACY_STORE,original);
  const records=loadRecords(storage);assert.equal(records[0].angleKind,'inner-v1');assert.equal(records[0].rom,135);
  assert.equal(comparable(records,'kneeR',context).length,0);
  writeRecords(storage,records);assert.equal(storage.getItem(LEGACY_STORE),original);
});
test('corrupted existing storage is reported rather than silently treated as empty',()=>{
  const storage=memory();storage.setItem(STORE,'not json');assert.throws(()=>loadRecords(storage));assert.equal(storage.getItem(STORE),'not json');
  storage.setItem(STORE,'{}');assert.throws(()=>loadRecords(storage));
});
test('comparisons isolate patient, posture, mode, target and joint',()=>{
  const a=record(),variants=['patient','posture','mode','target'].map((key,i)=>({...record('v'+i),context:{...context,[key]:key==='target'?120:'different'}}));
  assert.deepEqual(comparable([a,...variants,{...record('other-j'),j:'elbowR'}],'kneeR',context),[a]);
});
test('backup validation and merge are non-destructive and reject conflicting records',()=>{
  const a=record(),b=record('r2');
  assert.deepEqual(parseBackup(JSON.stringify({schema:'romvision',version:2,records:[a]})),[a]);
  assert.equal(mergeRecords([a],[a,b]).length,2);assert.deepEqual(a,record());
  assert.throws(()=>mergeRecords([a],[{...a,c:10}]),/서로 다른/);
  assert.throws(()=>parseBackup(JSON.stringify({schema:'romvision',version:2,records:[{...a,min:'10'}]})));
  assert.throws(()=>parseBackup(JSON.stringify({schema:'other',version:2,records:[]})));
  assert.throws(()=>parseBackup(JSON.stringify({schema:'romvision',version:2,records:[a,a]})));
});
test('CSV escapes quotes/newlines and neutralizes spreadsheet formulas in patient IDs',()=>{
  const a=record();a.context.patient='=HYPERLINK("x")';const text=csv([a]);assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes('"\'=HYPERLINK(""x"")"'));
});

test('lying orientation uses torso-relative view ratio and does not emit upright tilt warnings',()=>{
  const lm=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));
  lm[11]={x:.2,y:.49,visibility:1};lm[12]={x:.2,y:.51,visibility:1};lm[23]={x:.6,y:.49,visibility:1};lm[24]={x:.6,y:.51,visibility:1};
  const pose=assessPose(lm,JOINTS.hipR,960,720,'supine');assert.equal(pose.valid,true);assert.equal(pose.comp,false);
});
test('unsupported posture flags are stored as unavailable rather than zero',()=>{
  const m=new Measurement();hold(m,10,0);m.loseTracking();hold(m,110,1000);
  assert.equal(makeRecord(m,context,'kneeR','a').c,null);
  assert.equal(makeRecord(m,{...context,posture:'supine'},'hipR','b').c,null);
  assert.equal(makeRecord(m,context,'hipR','c').c,0);
});

test('periodic unconfirmed spikes do not discard an ongoing hold',()=>{
  const m=new Measurement();let accepted=0;
  for(let t=0;t<3000;t+=33)if(m.sample(t%400<33?60:10,t).accepted)accepted++;
  assert.ok(accepted>0);assert.ok(Math.abs(m.session.min-10)<.001);assert.ok(Math.abs(m.session.max-10)<.001);
});
test('a confirmed jump (three consistent frames) still re-acquires at the new angle',()=>{
  const m=new Measurement();hold(m,10,0);let t=840;
  for(let i=0;i<3;i++,t+=40)m.sample(100,t);
  assert.ok(Math.abs(m.sample(100,t).angle-100)<.001);
});
test('below the minimum frame rate no endpoint can be recorded',()=>{
  for(const [fps,expect] of [[4,false],[6,true]]){const m=new Measurement();for(let t=0;t<3000;t+=1000/fps)m.sample(10,t);assert.equal(Number.isFinite(m.session.min),expect);}
});
function sideLandmarks(farVisibility) {
  const lm=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));
  lm[12]={x:.5,y:.2,visibility:1};lm[11]={x:.52,y:.2,visibility:farVisibility};
  lm[24]={x:.5,y:.6,visibility:1};lm[23]={x:.52,y:.6,visibility:farVisibility};
  lm[26]={x:.5,y:.75,visibility:1};lm[28]={x:.5,y:.9,visibility:1};
  return lm;
}
test('side view tolerates an occluded far-side torso but not an occluded measured point',()=>{
  assert.equal(assessPose(sideLandmarks(.4),JOINTS.kneeR,960,720).valid,true);
  assert.equal(assessPose(sideLandmarks(.1),JOINTS.kneeR,960,720).valid,false);
  const lm=sideLandmarks(1);lm[26].visibility=.5;assert.equal(assessPose(lm,JOINTS.kneeR,960,720).valid,false);
});
test('oblique side view is measured but warned',()=>{
  const lm=sideLandmarks(1);lm[11]={x:.6,y:.2,visibility:1};
  const pose=assessPose(lm,JOINTS.kneeR,960,720);assert.equal(pose.valid,true);assert.match(pose.warning,/비스듬/);
  assert.equal(assessPose(sideLandmarks(1),JOINTS.kneeR,960,720).warning,null);
});
test('legacy migration keeps readable records, skips broken ones and marks posture flag unavailable',()=>{
  const storage=memory();storage.setItem(LEGACY_STORE,JSON.stringify([{t:10,j:'kneeR',min:45,max:180,rom:135},{t:11,j:'kneeR',min:'x'},null]));
  const {records,legacySkipped}=loadRecordsDetailed(storage);
  assert.equal(records.length,1);assert.equal(legacySkipped,2);assert.equal(records[0].c,null);assert.equal(records[0].id,'legacy-10-0');
});
test('merge treats records with different key order as identical',()=>{
  const a=record(),reordered=Object.fromEntries(Object.entries(record()).reverse());reordered.context=Object.fromEntries(Object.entries(a.context).reverse());
  assert.equal(mergeRecords([a],[reordered]).length,1);
});
test('validation names the offending field',()=>{
  assert.throws(()=>parseBackup(JSON.stringify({schema:'romvision',version:2,records:[{...record(),min:'10'}]})),/1번째 기록의 최소각/);
  assert.throws(()=>parseBackup('null'),/v2 백업/);
});
test('CSV neutralizes tab and carriage-return formula prefixes',()=>{
  const a=record();a.context.patient='\t=1+1';assert.ok(csv([a]).includes('"\'\t=1+1"'));
  a.context.patient='\r=1';assert.ok(csv([a]).includes('"\'\r=1"'));
});
