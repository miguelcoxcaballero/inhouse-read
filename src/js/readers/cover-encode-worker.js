self.onmessage = async ({ data }) => {
  const bitmap = data?.bitmap;
  let canvas;
  try {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cover encoder unavailable');
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type:'image/jpeg', quality:.9 });
    self.postMessage({ blob });
  } catch {
    self.postMessage({ unavailable:true });
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
};
