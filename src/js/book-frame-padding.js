// Reserve at most 16 empty logical pixels across a one-axis native shrink.
export function paddedBookFrameWidth(frame, previous, ratio, physical, allowed) {
 if (!allowed || !Number.isInteger(ratio) || ratio < 1 ||
   ![frame?.width,frame?.height,previous?.x,previous?.y].every(value=>Number.isInteger(value)&&value>0) ||
   previous.y !== frame.height || previous.x <= frame.width || previous.x-frame.width>16 ||
   physical?.width !== previous.x*ratio || physical?.height !== previous.y*ratio) return frame.width;
 return previous.x;
}

// Keep small blank rows as well, but never retain a page-sized framebuffer.
export function paddedBookFrameSize(frame, previous, ratio, physical, allowed) {
 const original = {width:frame.width, height:frame.height};
 if (!allowed || !Number.isInteger(ratio) || ratio < 1 ||
   ![frame?.width,frame?.height,previous?.x,previous?.y].every(value=>Number.isInteger(value)&&value>0) ||
   previous.x < frame.width || previous.x-frame.width > 16 ||
   physical?.width !== previous.x*ratio || physical?.height !== previous.y*ratio) return original;
 if (previous.y===frame.height) return {width:previous.x, height:frame.height};
 if (previous.y<=384 && previous.y>frame.height && previous.y-frame.height<=128)
   return {width:previous.x, height:previous.y};
 return original;
}
