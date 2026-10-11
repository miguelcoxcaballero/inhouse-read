import { generatePlacement } from './shelf-placement-cases.mjs';
export const shelfSessionCases = [10,16,40,200,1000].flatMap(count => [1,2,8,40,120].map(moves => ({
  name:`owned-drag-${count}-objects-${moves}-moves`,count,moves,seed:41,
})));
export function shelfSessionFixture(input) {
  const fixture=generatePlacement(input.seed,input.count);
  const targets=Array.from({length:input.moves},(_,index)=>({
    shelf:index%5,x:((index*17)%101)/100,
  }));
  return{fixture,targets};
}
