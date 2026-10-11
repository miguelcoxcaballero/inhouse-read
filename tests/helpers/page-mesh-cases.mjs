// Shared deterministic inputs, not an alternative implementation.
export const paperMeshCases = [
  { name:'shelf-block', kind:'block', width:132, height:200, depth:40, options:{} },
  { name:'detailed-block', kind:'block', width:264, height:400, depth:80, options:{ detail:true } },
  { name:'thin-block', kind:'block', width:62.125, height:92.375, depth:8.25, options:{ detail:true } },
  { name:'wide-block', kind:'block', width:400, height:240, depth:120, options:{ board:2, inset:3, detail:true } },
  { name:'first-page-leaves', kind:'leaves', width:264, height:400, depth:0, options:{} },
  { name:'half-read-leaves', kind:'leaves', width:264, height:400, depth:40, options:{} },
  { name:'thin-leaves', kind:'leaves', width:62.125, height:92.375, depth:2.5, options:{ columns:8 } },
  { name:'wide-leaves', kind:'leaves', width:400, height:240, depth:60, options:{ board:2, inset:3, columns:32 } },
];
