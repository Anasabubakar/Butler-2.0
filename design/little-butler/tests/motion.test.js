import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STATES,POSES,frameAt} from '../src/motion.js';
test('Every animation references real transparent pose assets',()=>{
 for(const state of Object.keys(STATES))for(let i=0;i<=100;i++){
   const f=frameAt(state,i/100);
   assert.ok(POSES.includes(f.pose));
   assert.ok(fs.existsSync(new URL(`../assets/poses/${f.pose}.png`,import.meta.url)));
   for(const key of ['x','y','rotation','sx','sy','alpha'])assert.ok(Number.isFinite(f[key]),`${state} ${key}`);
   assert.ok(f.sx>0&&f.sy>0);
 }
});
test('One-shot transitions always reach valid states',()=>{
 for(const spec of Object.values(STATES))if(!spec.loop)assert.ok(STATES[spec.next]);
 assert.ok(Math.abs(frameAt('summon',1).y)<.00001);
 assert.equal(frameAt('hide',1).y,155);
});
test('Loop curves meet at their seam',()=>{
 for(const [state,spec]of Object.entries(STATES))if(spec.loop){
   const a=frameAt(state,0),b=frameAt(state,1);
   assert.equal(a.pose,b.pose);
   for(const key of ['x','y','rotation','sx','sy'])assert.ok(Math.abs(a[key]-b[key])<.00001,`${state} ${key}`);
 }
});
test('Reduced motion removes movement and preserves hidden states',()=>{
 for(const state of Object.keys(STATES)){
   const a=frameAt(state,.1,true),b=frameAt(state,.7,true);
   assert.equal(a.rotation,0);assert.equal(a.sx,1);assert.equal(a.sy,1);assert.equal(a.y,b.y);
 }
 assert.equal(frameAt('peek',.5,true).y,151);
});
test('Unknown states fail explicitly',()=>assert.throws(()=>frameAt('oops'),RangeError));
test('Atlas rectangles fit and match animation clip counts',()=>{
 const atlas=JSON.parse(fs.readFileSync(new URL('../assets/butler-atlas.json',import.meta.url)));
 assert.equal(Object.keys(atlas.frames).length,Object.keys(STATES).length*12);
 for(const [name,clip]of Object.entries(atlas.animations)){
   assert.equal(clip.frames.length,12);assert.equal(clip.duration,STATES[name].duration);
   for(const id of clip.frames){const {frame:f}=atlas.frames[id];assert.ok(f.x>=0&&f.y>=0&&f.x+f.w<=atlas.meta.size.w&&f.y+f.h<=atlas.meta.size.h);}
 }
});
