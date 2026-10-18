// Decodes a country image and clips the cropped part of it to each of the
// country's polygons, off the main thread. clipQueue.js downloads the image.
// Each polygon gets the whole crop, stretched over the polygon's bounding box.
// A { cancel: id } message aborts that job.
const controllers = new Map();

self.onmessage = async (e) => {
  if ('cancel' in e.data) {
    controllers.get(e.data.cancel)?.abort();
    return;
  }
  const { id, blob, crop, rings } = e.data;
  const controller = new AbortController();
  controllers.set(id, controller);
  try {
    const bitmap = await createImageBitmap(blob);
    const sx = Math.round(bitmap.width * crop.x);
    const sy = Math.round(bitmap.height * crop.y);
    const width = Math.round(bitmap.width * crop.width);
    const height = Math.round(bitmap.height * crop.height);

    const results = [];
    try {
      for (const ring of rings) {
        controller.signal.throwIfAborted();
        const { bounds, coordinates } = getBounds(ring);
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        clipToRing(ctx, ring, bounds, width, height);
        ctx.drawImage(bitmap, sx, sy, width, height, 0, 0, width, height);
        results.push({ blob: await canvas.convertToBlob(), coordinates });
      }
    } finally {
      bitmap.close();
    }
    self.postMessage({ id, results });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  } finally {
    controllers.delete(id);
  }
};

const MAX_LATITUDE = 85.0511;

function getBounds(ring) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  minLat = Math.max(minLat, -MAX_LATITUDE);
  maxLat = Math.min(maxLat, MAX_LATITUDE);
  return {
    bounds: { topLeft: mercator(minLon, maxLat), bottomRight: mercator(maxLon, minLat) },
    coordinates: [[minLon, maxLat], [maxLon, maxLat], [maxLon, minLat], [minLon, minLat]]
  };
}

function clipToRing(ctx, ring, { topLeft, bottomRight }, width, height) {
  ctx.beginPath();
  ring.forEach(([lon, lat], i) => {
    const p = mercator(lon, lat);
    const x = (p.x - topLeft.x) / (bottomRight.x - topLeft.x) * width;
    const y = (p.y - topLeft.y) / (bottomRight.y - topLeft.y) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
}

function mercator(lon, lat) {
  const R = 6378137;
  const DEG = Math.PI / 180;
  const sin = Math.sin(lat * DEG);
  return { x: R * lon * DEG, y: R * Math.log((1 + sin) / (1 - sin)) / 2 };
}
