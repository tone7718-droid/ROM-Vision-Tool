import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const dir=new URL('../vendor/mediapipe/',import.meta.url);
test('vendored MediaPipe files match recorded SHA-256 checksums',()=>{
  const lines=fs.readFileSync(new URL('SHA256SUMS',dir),'utf8').trim().split('\n');
  assert.ok(lines.length>=6);
  for(const line of lines){
    const [hash,name]=line.split(/\s+\*?/);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(name,dir))).digest('hex'),hash,name);
  }
});
test('page loads no third-party scripts, styles or fonts',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  assert.doesNotMatch(html+app,/https:\/\/(cdn\.jsdelivr|fonts\.g|storage\.googleapis)/);
  assert.match(html,/Content-Security-Policy/);
});
