// Reserve at most 16 empty logical pixels across a one-axis native shrink.
export function paddedBookFrameWidth(frame, previous, ratio, physical, allowed) {
 if (!allowed || !Number.isInteger(ratio) || ratio < 1 ||
   ![frame?.width,frame?.height,previous?.x,previous?.y].every(value=>Number.isInteger(value)&&value>0) ||
   previous.y !== frame.height || previous.x <= frame.width || previous.x-frame.width>16 ||
   physical?.width !== previous.x*ratio || physical?.height !== previous.y*ratio) return frame.width;
 return previous.x;
}
