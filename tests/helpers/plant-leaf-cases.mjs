export const plantLeafCases = [
  {name:'sword',variant:'upright',length:61.75,width:10.375,curve:.054,twist:-.12,detailed:true},
  {name:'succulent',variant:'succulent',length:26.7,width:14.9,curve:.05,twist:.063,detailed:true},
  {name:'palm-pinna',variant:'palm',length:10.4,width:1.82,curve:.13,twist:.027,detailed:true},
  {name:'fern-pinna',variant:'fern',length:8.612,width:2.01,curve:.06,twist:-.087,detailed:true},
  {name:'zz-blade',variant:'zz',length:21.64,width:8.16,curve:.07,twist:.013,detailed:true},
  {name:'legacy-heart',variant:'leafy',length:40.07,width:20.6,curve:.11,twist:-.22,detailed:false},
  {name:'legacy-monstera',variant:'monstera',length:56.98,width:37.2,curve:.13,twist:.012,detailed:true},
  {name:'legacy-ivy',variant:'ivy',length:19.76,width:10.162,curve:.05,twist:.38,detailed:false},
].map((item,index)=>({...item,tint:.00431+index*.00813,hue:-.037+index*.00761}));

export const plantModelCases = [
  {catalogId:'sansevieria',seed:'rust-botanical:snake'},
  {catalogId:'succulent',seed:'rust-botanical:rosette'},
  {catalogId:'chamaedorea',seed:'rust-botanical:palm'},
  {catalogId:'nephrolepis',seed:'rust-botanical:fern'},
  {catalogId:'zamioculcas',seed:'rust-botanical:zz'},
  // Negative routing controls: these use other generators and must stay exact.
  {catalogId:'hedera',seed:'rust-botanical:ivy'},
  {catalogId:'monstera',seed:'rust-botanical:monstera'},
  {catalogId:'cactus',seed:'rust-botanical:cactus'},
];
export const expectedPlantLeafCalls = {sansevieria:8,succulent:27,chamaedorea:230,nephrolepis:666,zamioculcas:66,hedera:0,monstera:0,cactus:0};
