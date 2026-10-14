export class LegacyReaderNavigation{
 generation=0
 navigating=false
 tail=Promise.resolve()
 cancel(){this.generation++;this.tail=Promise.resolve();this.navigating=false}
 enqueue(action,validate){
  const generation=this.generation
  const current=()=>this.generation===generation&&validate()
  const task=this.tail.catch(()=>{}).then(async()=>{
   if(!current())return
   this.navigating=true
   try{return await action(validate)}finally{if(current())this.navigating=false}
  })
  this.tail=task
  return task
 }
}
