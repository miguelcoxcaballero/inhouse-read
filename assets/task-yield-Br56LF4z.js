let e,r=0;const n=new Map;function a(){e||=new MessageChannel,e.port1.onmessage||=s=>{const o=n.get(s.data);o&&(n.delete(s.data),n.size||e.port1.unref?.(),o())},e.port1.ref?.();const t=++r;return new Promise(s=>{n.set(t,s),e.port2.postMessage(t)})}export{a as y};
//# sourceMappingURL=task-yield-Br56LF4z.js.map
