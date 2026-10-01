import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STORE,LEGACY_STORE} from '../core.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
class Element {
  constructor(){this.value='';this.style={};this.children=[];this.classList={add(){},remove(){}};this.files=[];this.textContent='';}
  addEventListener(type,fn){this['on'+type]=fn;}
  setAttribute(k,v){this[k]=v;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  getContext(){return {};}
  click(){return this.onclick?.();}
  pause(){}
}
let seq=0;
async function setup(initial=[]) {
  const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const $=id=>{assert.ok(elements.has(id),'missing UI element '+id);return elements.get(id);};
  for(const [id,value] of Object.entries({jointSelect:'kneeR',patientId:'self',posture:'standing',measureMode:'active',targetAngle:'135'}))$(id).value=value;
  const map=new Map([[STORE,JSON.stringify(initial)]]),alerts=[];
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  globalThis.document={getElementById:$,createElement:()=>new Element(),createElementNS:()=>new Element(),addEventListener(){},body:new Element()};
  globalThis.window={addEventListener(){}};globalThis.localStorage=storage;
  globalThis.alert=message=>alerts.push(message);globalThis.confirm=()=>true;
  globalThis.cancelAnimationFrame=()=>{};
  await import('../app.js?test='+seq++);
  return {$,map,alerts,storage};
}
const r=(id,patient='self')=>({id,t:100,j:'kneeR',min:10,max:110,rom:100,c:null,frames:40,angleKind:'clinical-v2',context:{patient,posture:'standing',mode:'active',target:135}});
test('app initializes with complete DOM bindings and patient-specific history',async()=>{
  const {$}=await setup([r('a'),r('b','other')]);
  assert.match($('historyNotice').textContent,/전체 2개 · 동일 조건 1개/);
  assert.equal($('histList').children.length,1);assert.match($('angleLabel').textContent,/굴곡각/);
  assert.equal($('stopBtn').disabled,true);
  $('patientId').value='other';$('patientId').onchange();assert.equal($('histList').children.length,1);
  $('jointSelect').value='shoulderR';$('jointSelect').onchange();assert.equal($('targetAngle').value,165);
  assert.match($('angleLabel').textContent,/외전각/);assert.equal($('histList').children.length,0);
});
test('empty measurement cannot save or replace persisted data',async()=>{
  const {$,map,alerts}=await setup([r('a')]);const before=map.get(STORE);$('saveBtn').click();
  assert.equal(map.get(STORE),before);assert.match(alerts[0],/끝범위/);
});
test('delete failure retains stored record and does not claim success',async()=>{
  const {$,map,alerts,storage}=await setup([r('a')]);const before=map.get(STORE);
  storage.setItem=()=>{throw new Error('quota');};$('histList').children[0].children[1].click();
  assert.equal(map.get(STORE),before);assert.equal($('histList').children.length,1);assert.match(alerts[0],/저장 실패/);
});
test('restore validates before changing data and merges without deleting existing records',async()=>{
  const {$,map,alerts}=await setup([r('a')]);const before=map.get(STORE);
  $('restoreFile').files=[{size:10,text:async()=>'{bad'}];await $('restoreFile').onchange();
  assert.equal(map.get(STORE),before);assert.match(alerts.at(-1),/복원 실패/);
  $('restoreFile').files=[{size:500,text:async()=>JSON.stringify({schema:'romvision',version:2,records:[r('b')]})}];await $('restoreFile').onchange();
  assert.equal(JSON.parse(map.get(STORE)).length,2);assert.match($('feedback').textContent,/복원이 완료/);
});
test('legacy source is preserved when v2 backup records are restored',async()=>{
  const {$,map}=await setup([]);map.delete(STORE);const legacy=JSON.stringify([{t:1,j:'kneeR',min:45,max:180,rom:135}]);map.set(LEGACY_STORE,legacy);
  $('restoreFile').files=[{size:500,text:async()=>JSON.stringify({schema:'romvision',version:2,records:[r('a')]})}];await $('restoreFile').onchange();
  const data=JSON.parse(map.get(STORE));assert.equal(data.length,2);assert.equal(data[0].angleKind,'inner-v1');assert.equal(map.get(LEGACY_STORE),legacy);
});
test('corrupt storage blocks a restore instead of overwriting old bytes',async()=>{
  const {$,map}=await setup([]);map.set(STORE,'broken');
  $('restoreFile').files=[{size:500,text:async()=>JSON.stringify({schema:'romvision',version:2,records:[r('a')]})}];await $('restoreFile').onchange();
  assert.equal(map.get(STORE),'broken');assert.match($('historyNotice').textContent,/기록 읽기 실패/);
});
test('summary avoids recovery claims and reports unsupported posture flags explicitly',async()=>{
  const {$}=await setup([r('a'),r('b')]);$('aiBtn').click();
  assert.match($('aiBox').textContent,/미지원/);assert.match($('aiBox').textContent,/판정하지 않습니다/);
});

test('camera without browser support fails clearly and leaves controls available',async()=>{
  const {$,alerts}=await setup([]);await $('startBtn').click();
  assert.match(alerts.at(-1),/카메라/);assert.equal($('patientId').disabled,false);assert.equal($('startBtn').disabled,false);
});
