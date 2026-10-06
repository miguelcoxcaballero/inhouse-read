import * as E from './engine.js';
import {MODEL,CITY,PROJECTS} from './data.js';
export const opDays=m=>new Date(Date.UTC(2022+Math.floor(m/12),m%12+1,0)).getUTCDate();
export const clockText=m=>`${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(Math.floor(m)%60).padStart(2,'0')}${m>=1440?' +'+Math.floor(m/1440):''}`;
export function dayDate(s){return new Date(Date.UTC(2022+Math.floor(Math.min(s.month,347)/12),Math.min(s.month,347)%12,s.ops?.day||1));}
export function dayLabel(s){return dayDate(s).toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});}
export function ensureOps(s){if(!s.ops)s.ops={day:1,minute:0,phase:'planning',incidents:[],resolved:[],last:null,priority:'balanced',completed:0};return s.ops;}
export function servicePlan(s){
 const trips=[];const op=ensureOps(s);
 for(const r of s.routes.filter(r=>r.active)){
  const f=s.fleet.find(f=>f.id===r.fleet),m=MODEL[f?.model];if(!m)continue;
  const first=Number.isFinite(r.first)?r.first:r.kind==='commuter'?330:360;
  const last=Number.isFinite(r.last)?r.last:r.kind==='commuter'?1410:1260;
  const duration=Math.round((r.km/Math.max(30,Math.min(r.speed,m.speed)*.78)+.18)*60);
  const work=s.projects.find(p=>!p.done&&(p.route===r.id||PROJECTS.find(d=>d.id===p.id)?.routes.includes(r.id)));
  for(let direction=0;direction<(r.circular?1:2);direction++)for(let i=0;i<r.frequency;i++){
   const dep=Math.round(first+(last-first)*(r.frequency===1?0:i/(r.frequency-1)))+direction*7;
   const id=`${r.id}-${direction}-${i}`;
   const incident=op.incidents.find(x=>x.trip===id);const resolved=op.resolved.includes(id);
   let delay=work?8:0;if(incident)delay+=resolved?Math.ceil(incident.delay*.25):incident.delay;
   if(op.priority==='punctual'&&delay)delay=Math.max(0,delay-5);
   trips.push({id,route:r.id,name:E.routeName(r),model:m.name,dep,arrival:dep+duration+delay,scheduled:dep+duration,duration,delay,direction,seats:m.seats,ends:direction?[...r.ends].reverse():r.ends,coords:r.via.map(id=>[CITY[id].lon,CITY[id].lat]),real:false});
  }
 }
 return trips.sort((a,b)=>a.dep-b.dep||a.id.localeCompare(b.id));
}
export function dayBounds(trips){return trips.reduce((v,t)=>({first:Math.min(v.first,t.dep),last:Math.max(v.last,t.arrival)}),trips.length?{first:Infinity,last:0}:{first:360,last:360});}
export function startDay(s){
 E.ensurePlaying(s);if(!s.started||E.pendingDecision(s))throw Error('Resuelve primero el consejo de dirección.');
 const op=ensureOps(s);if(op.phase==='running')return;
 op.incidents=[];op.resolved=[];const trips=servicePlan(s);
 // Seeded daily events: one incident at most, independent of rendering or frame rate.
 if(trips.length&&E.random(s)<.42){const trip=trips[Math.floor(E.random(s)*trips.length)],delay=12+Math.floor(E.random(s)*34);op.incidents.push({trip:trip.id,route:trip.route,at:trip.dep+Math.floor(trip.duration*.35),delay,reason:['Fallo de señalización','Avería de material','Restricción temporal de velocidad','Incidencia en una estación'][Math.floor(E.random(s)*4)]});}
 op.minute=dayBounds(servicePlan(s)).first;op.phase='running';
}
export function moveClock(s,minutes=10){const op=ensureOps(s);if(op.phase!=='running')return false;const last=dayBounds(servicePlan(s)).last;op.minute=Math.min(last,op.minute+minutes);return op.minute>=last;}
export function resolveIncident(s,id){const op=ensureOps(s),incident=op.incidents.find(x=>x.trip===id);if(!incident||op.phase!=='running'||op.minute<incident.at||op.resolved.includes(id))throw Error('No hay una incidencia pendiente que atender.');E.spend(s,.018);op.resolved.push(id);}
export function endDay(s){
 const op=ensureOps(s);if(op.phase!=='running'||op.minute<dayBounds(servicePlan(s)).last)throw Error('La jornada termina cuando llega el último tren.');
 const trips=servicePlan(s),late=trips.filter(t=>t.delay>5).length,b=E.balance(s);
 const penalties=trips.reduce((v,t)=>v+t.delay*.0006,0)+(op.priority==='punctual'?.009:0);
 s.cash-=penalties;s.satisfaction=E.clamp(s.satisfaction-(late/Math.max(1,trips.length))*.5,0,100);
 op.last={date:dayLabel(s),trains:trips.length,late,punctuality:Math.round((1-late/Math.max(1,trips.length))*100),passengers:Math.round(b.passengers/opDays(s.month)),net:b.net/opDays(s.month)-penalties,first:dayBounds(trips).first,last:op.minute,incidents:op.incidents.length,attended:op.resolved.length};
 op.completed++;op.phase='review';return op.last;
}
export function nextDay(s){const op=ensureOps(s);if(op.phase!=='review')throw Error('Cierra primero la jornada.');const last=op.last,completed=op.completed,priority=op.priority;
 if(op.day>=opDays(s.month)){if(!E.step(s))throw Error('No se puede cerrar el mes.');op.day=1;}else op.day++;
 Object.assign(op,{phase:'planning',minute:0,incidents:[],resolved:[],last,completed,priority});
}
export function skipMonth(s){const op=ensureOps(s);if(op.phase==='running')throw Error('Termina la jornada antes de delegar el mes.');if(!E.step(s))return false;Object.assign(op,{day:1,phase:'planning',minute:0,incidents:[],resolved:[]});return true;}
export function daylight(s,minute){
 const date=dayDate(s),start=new Date(Date.UTC(date.getUTCFullYear(),0,0));const day=(date-start)/864e5;
 const daylightHours=12+3.25*Math.sin((day-80)*Math.PI*2/365.25);
 // Iberian civil time and seasonal duration; atmospheric effect, not an astronomical ephemeris.
 const noon=13.8*60+(date.getUTCMonth()>2&&date.getUTCMonth()<10?30:0),rise=noon-daylightHours*30,set=noon+daylightHours*30;
 const time=minute%1440,light=Math.max(0,Math.min(1,(time-rise+35)/70,(set-time+35)/70));
 return {light,rise,set,night:1-light};
}
export function constructionStatus(s,p){const progress=p.done?1:E.clamp((s.month+(ensureOps(s).day-1)/opDays(s.month)-p.started)/(p.due-p.started||1),0,.99);const names=['Estudio y permisos','Plataforma y estructuras','Montaje de vía','Electrificación y señalización','Pruebas y autorización'];return {progress,stage:p.done?'En servicio':names[Math.min(4,Math.floor(progress*5))]};}
