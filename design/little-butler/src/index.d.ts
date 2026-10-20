export type ButlerState='idle'|'blink'|'peek'|'summon'|'listen'|'think'|'work'|'success'|'error'|'sleep'|'drag'|'pleased'|'speak'|'attention'|'hide'|'surprised'|'record'|'transfer'|'offline'|'quiet';
export interface Device {id:string;name:string;online:boolean}
export interface MotionFrame {pose:string;x:number;y:number;rotation:number;sx:number;sy:number;alpha:number}
export const STATES:Record<ButlerState,{duration:number;loop:boolean;pose:string;next?:ButlerState}>;
export function frameAt(state:ButlerState,time?:number,reduced?:boolean):MotionFrame;
export class LittleButler extends HTMLElement {
  ready:Promise<void>;
  readonly state:ButlerState;
  setState(state:ButlerState,options?:{message?:string;progress?:number}):void;
  open():void;hide():void;stop():void;
  say(text:string,options?:{speak?:boolean}):void;
  setVoice(enabled:boolean):void;setMicrophone(enabled:boolean):void;
  setQuiet(enabled:boolean):void;setReducedMotion(enabled:boolean):void;
  setSize(size:'small'|'medium'):void;
  setScreenContext(enabled:boolean):void;setDevices(devices:Device[]):void;
  dock(side:'left'|'right'):void;
  confirm(options?:{title?:string;description?:string;recipient?:string;device?:string;attachment?:string}):Promise<boolean>;
}
declare global {interface HTMLElementTagNameMap {'little-butler':LittleButler}}
