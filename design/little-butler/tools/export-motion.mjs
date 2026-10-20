import fs from 'node:fs';
import {STATES,frameAt} from '../src/motion.js';
fs.mkdirSync(new URL('../assets/',import.meta.url),{recursive:true});
const data={version:1,frameSize:{w:192,h:240},sourceSize:{w:256,h:320},framesPerState:12,states:{}};
for(const [name,spec] of Object.entries(STATES)){
  data.states[name]={...spec,fps:12000/spec.duration,frames:Array.from({length:12},(_,i)=>frameAt(name,spec.loop?i/12:i/11))};
}
fs.writeFileSync(new URL('../assets/motion.json',import.meta.url),JSON.stringify(data,null,2));
console.log(`Exported motion curves for ${Object.keys(STATES).length} states.`);
