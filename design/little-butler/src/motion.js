/** Pure deterministic animation sampling. Time is normalized 0..1. */
export const STATES = Object.freeze({
  idle:      {duration: 3200, loop: true, pose: 'idle'},
  blink:     {duration: 180, loop: false, pose: 'blink', next: 'idle'},
  peek:      {duration: 1600, loop: true, pose: 'peek'},
  summon:    {duration: 520, loop: false, pose: 'summon', next: 'idle'},
  listen:    {duration: 2000, loop: true, pose: 'listen'},
  think:     {duration: 2200, loop: true, pose: 'think'},
  work:      {duration: 1500, loop: true, pose: 'work'},
  success:   {duration: 850, loop: false, pose: 'success', next: 'idle'},
  error:     {duration: 650, loop: false, pose: 'error', next: 'idle'},
  sleep:     {duration: 4000, loop: true, pose: 'sleep'},
  drag:      {duration: 1100, loop: true, pose: 'drag'},
  pleased:   {duration: 1000, loop: false, pose: 'pleased', next: 'idle'},
  speak:     {duration: 700, loop: true, pose: 'speak'},
  attention: {duration: 2200, loop: true, pose: 'attention'},
  hide:      {duration: 400, loop: false, pose: 'hide', next: 'peek'},
  surprised: {duration: 700, loop: false, pose: 'surprised', next: 'idle'},
  record:    {duration: 1500, loop: true, pose: 'work'},
  transfer:  {duration: 1800, loop: true, pose: 'attention'},
  offline:   {duration: 3500, loop: true, pose: 'error'},
  quiet:     {duration: 4000, loop: true, pose: 'sleep'}
});
const clamp = n => Math.max(0, Math.min(1, n));
const ease = t => 1 - Math.pow(1-t, 3);
export function frameAt(state, time = 0, reduced = false) {
  if (!STATES[state]) throw new RangeError(`Unknown state: ${state}`);
  const t=clamp(time), wave=Math.sin(t*Math.PI*2), arc=Math.sin(t*Math.PI);
  let f={pose:STATES[state].pose, x:0, y:0, rotation:0, sx:1, sy:1, alpha:1};
  // Coordinates are pixels in the common 256 × 320 source space.
  switch(state) {
    case 'idle': f.sy=1+wave*.009; f.sx=1-wave*.003; break;
    case 'blink': f.pose=t<.18 || t>.82 ? 'idle':'blink'; break;
    case 'peek': f.y=151+wave*2; f.rotation=wave*.6; break;
    case 'summon':
      f.y=155*(1-ease(t))-Math.sin(t*Math.PI)*10;
      f.rotation=-6*(1-t)*arc;
      f.pose=t<.2?'peek':t<.78?'summon':'idle'; break;
    case 'listen': f.rotation=wave*2; f.y=-arc*2; break;
    case 'think': f.rotation=wave*1.4; f.sy=1+wave*.005; break;
    case 'work': case 'record': f.y=-Math.abs(wave)*2; f.rotation=wave*1.2; break;
    case 'success': f.pose=t<.12||t>.88?'idle':'success'; f.sy=1-arc*.055; break;
    case 'error': f.rotation=Math.sin(t*Math.PI*4)*(1-t)*3; break;
    case 'sleep': f.sy=1+wave*.012; break;
    case 'drag': f.rotation=wave*7; f.y=-5+arc*3; break;
    case 'pleased': f.y=-arc*4; break;
    case 'speak': f.pose=wave>-.15?'speak':'idle'; f.sy=1+wave*.008; break;
    case 'attention': f.rotation=wave*.7; break;
    case 'hide': f.pose=t<.25?'idle':'hide'; f.y=155*ease(t); break;
    case 'surprised': f.y=-arc*9; f.sx=1-arc*.025; f.sy=1+arc*.04; break;
    case 'transfer': f.rotation=wave*1.2; break;
    case 'offline': f.sy=1+wave*.004; break;
    case 'quiet': f.y=151; f.sy=1+wave*.004; break;
  }
  if (reduced) {
    f={...f,x:0,y:['peek','quiet','hide'].includes(state)?151:0,rotation:0,sx:1,sy:1};
    if(state==='summon') f.pose='idle';
  }
  return f;
}
export const POSES=Object.freeze([...new Set(Object.values(STATES).map(s=>s.pose))]);
