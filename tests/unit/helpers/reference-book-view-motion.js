// Frozen renderer scheduling policy before Rust ownership migration.
export function referenceBookViewMotion(host) {
  let cancel=()=>{},motionCapacity=null,disposed=false;
  return {
    get motionCapacity(){return motionCapacity;},
    dispose(){cancel();disposed=true;},
    start(frames,{duration,onFrame},current,options){
      cancel();
      if(current)frames=[{...frames[0],transform:current},...frames.slice(1)];
      const sampler=host.createSampler(frames);
      if(duration>0&&!onFrame&&options.direct&&options.compact&&options.adaptive&&
          Number.isInteger(options.ratio)&&Number.isInteger(options.width)&&Number.isInteger(options.height)){
        const capacity={width:0,height:0};
        try{
          for(let i=0;i<=16;i++){
            const pose=sampler.sample(i/16),frame=host.measure(pose);
            capacity.width=Math.max(capacity.width,frame.width);capacity.height=Math.max(capacity.height,frame.height);
          }
          motionCapacity=capacity;
        }catch(error){sampler.dispose();throw error;}
        finally{if(current)host.position(current);}
      }
      let raf,resolve;const finished=new Promise(r=>resolve=r);
      cancel=()=>{cancelAnimationFrame(raf);sampler.dispose();motionCapacity=null;resolve();};
      const lastFrame=performance.now(),animation={finished,cancel,lastFrameTime:lastFrame};
      sampler.start(duration,lastFrame);
      const tick=()=>{
        if(disposed){sampler.dispose();motionCapacity=null;return resolve();}
        const t=sampler.step(performance.now()),pose=sampler.sample(t);
        if(!onFrame?.(pose))host.draw(pose);
        animation.lastFrameTime=performance.now();
        if(t<1)raf=requestAnimationFrame(tick);else{sampler.dispose();motionCapacity=null;resolve();}
      };
      raf=requestAnimationFrame(tick);return animation;
    },
  };
}
