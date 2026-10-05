export function samplePaperTone(data) {
  const n = 12, ring = [];
  for (let i = 0; i < n - 1; i++) for (const [x, y] of [[i, 0], [n - 1, i], [n - 1 - i, n - 1], [0, n - 1 - i]]) {
    const k = (y * n + x) * 4;
    if (data[k + 3] > 200) ring.push(k);
  }
  const channels = [0, 1, 2].map(o => ring.map(k => data[k + o]).sort((a, b) => a - b));
  const quartile = (values, q) => values[Math.floor((values.length - 1) * q)];
  return ring.length >= 16 && channels.every(values => quartile(values, .75) - quartile(values, .25) <= 20)
    ? channels.map(values => quartile(values, .5)) : null;
}

