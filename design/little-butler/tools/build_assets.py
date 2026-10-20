"""Pack generated poses and deterministic runtime transforms into transparent sprites.
Art source is reference/source-atlas.png; this script only packs/rasterizes exports.
Requires Python 3 and Pillow. Run node tools/export-motion.mjs first.
"""
from pathlib import Path
import json, math
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
data=json.loads((ROOT/'assets/motion.json').read_text())
W,H=data['frameSize']['w'],data['frameSize']['h']
N=data['framesPerState']
atlas=Image.new('RGBA',(W*N,H*len(data['states'])))
poses={p.stem:Image.open(p).convert('RGBA') for p in (ROOT/'assets/poses').glob('*.png')}
out=ROOT/'assets/animations';out.mkdir(exist_ok=True)
frames_meta={}; clips={}
for row,(state,spec) in enumerate(data['states'].items()):
    strip=Image.new('RGBA',(W*N,H))
    frames_dir=out/state;frames_dir.mkdir(exist_ok=True)
    names=[]
    for i,f in enumerate(spec['frames']):
        # Invert the same bottom-center affine transform as the JS canvas renderer.
        rad=math.radians(f['rotation']);c,s=math.cos(rad),math.sin(rad)
        tx,ty=128+f['x'],304+f['y']
        a,b=c/f['sx'],s/f['sx'];d,e=-s/f['sy'],c/f['sy']
        matrix=(a,b,128-a*tx-b*ty,d,e,304-d*tx-e*ty)
        frame=poses[f['pose']].transform((256,320),Image.Transform.AFFINE,matrix,Image.Resampling.BICUBIC)
        frame=frame.resize((W,H),Image.Resampling.LANCZOS)
        frame.save(frames_dir/f'{i:02}.png',optimize=True)
        strip.alpha_composite(frame,(i*W,0));atlas.alpha_composite(frame,(i*W,row*H))
        key=f'{state}/{i:02}'
        frames_meta[key]={'frame':{'x':i*W,'y':row*H,'w':W,'h':H},'rotated':False,'trimmed':False,'spriteSourceSize':{'x':0,'y':0,'w':W,'h':H},'sourceSize':{'w':W,'h':H},'duration':round(spec['duration']/N),'pivot':{'x':.5,'y':.95}}
        names.append(key)
    strip.save(out/f'{state}.png',optimize=True)
    clips[state]={'frames':names,'duration':spec['duration'],'loop':spec['loop'],'next':spec.get('next'), 'strip':f'animations/{state}.png'}
    # A portable animated preview for apps that accept WebP animation.
    images=[Image.open(frames_dir/f'{i:02}.png') for i in range(N)]
    images[0].save(out/f'{state}.webp',save_all=True,append_images=images[1:],duration=round(spec['duration']/N),loop=0 if spec['loop'] else 1,lossless=True)
atlas.save(ROOT/'assets/butler-atlas.png',optimize=True)
manifest={'frames':frames_meta,'animations':clips,'meta':{'app':'Little Butler asset builder','version':'0.1.0','image':'butler-atlas.png','format':'RGBA8888','size':{'w':atlas.width,'h':atlas.height},'scale':'1','frameSize':{'w':W,'h':H},'origin':'top-left','premultipliedAlpha':False}}
(ROOT/'assets/butler-atlas.json').write_text(json.dumps(manifest,indent=2))
print(f'Packed {len(frames_meta)} RGBA frames, {len(clips)} strips and WebP previews; atlas {atlas.size}.')
