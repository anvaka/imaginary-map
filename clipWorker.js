// Decodes a country image and clips the cropped part of it to each of the
// country's polygons, off the main thread. clipQueue.js downloads the image.
// Face boxes ({ faces }, [x, y, w, h] fractions of the image) come from
// faceBoxes.json, which scripts/face-detection/ writes.
// A { cancel: id } message aborts that job.
//
// The image keeps its aspect ratio. Each big ring (a "host") gets its own copy,
// scaled and moved so the face lands on land, or, for an image without a face,
// covering the ring; small rings next to a host ("satellites") show the part
// of the host's image that falls on them.
const controllers = new Map();

// Image sizes to try, relative to the smallest one covering the ring: zooming
// in a little frees the face to move onto the land; below 1 the image no
// longer covers the ring and something else fills the rest.
const ZOOMS = [1, 1.15, 1.3, 1.5, 1.75, 2, 0.85, 0.7, 0.55, 0.45, 0.36, 0.28, 0.22, 0.17, 0.13];
const MIN_FACE_VISIBLE = 0.75;

self.onmessage = async (e) => {
  if ('cancel' in e.data) {
    controllers.get(e.data.cancel)?.abort();
    return;
  }
  const { id, blob, crop, rings, faces } = e.data;
  const controller = new AbortController();
  const { signal } = controller;
  controllers.set(id, controller);
  try {
    const bitmap = await createImageBitmap(blob);
    const src = {
      bitmap,
      x: Math.round(bitmap.width * crop.x),
      y: Math.round(bitmap.height * crop.y),
      width: Math.round(bitmap.width * crop.width),
      height: Math.round(bitmap.height * crop.height)
    };
    const face = faceInCrop(faces, crop);

    const results = [];
    try {
      for (const { ring, frame, backdrop } of planFrames(rings, face)) {
        signal.throwIfAborted();
        results.push({ blob: await drawRing(ring, frame, backdrop, src), coordinates: ring.coordinates });
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

// Face boxes are [x, y, w, h] in fractions of the whole image; returns the
// biggest one centered inside the crop, in fractions of the crop, or null
function faceInCrop(faces = [], crop) {
  let best = null;
  for (const [x, y, w, h] of faces) {
    const cx = (x + w / 2 - crop.x) / crop.width, cy = (y + h / 2 - crop.y) / crop.height;
    if (cx < 0 || cx > 1 || cy < 0 || cy > 1 || (best && w * h <= best.area)) continue;
    best = { area: w * h, box: [(x - crop.x) / crop.width, (y - crop.y) / crop.height, w / crop.width, h / crop.height] };
  }
  return best ? best.box : null;
}

// Returns [{ ring, frame, backdrop }], where a frame is where the image sits on
// the map: { x0, y1, size } in Mercator meters, x0/y1 its top-left corner.
function planFrames(lonLatRings, face) {
  const rings = lonLatRings.map(prepareRing);
  // Rings across the antimeridian from the biggest one are moved next to it
  const main = rings.reduce((a, b) => (b.area > a.area ? b : a));
  for (const ring of rings) ring.shift = closestCopy(ring, main);

  return groupSatellites(rings).flatMap(({ host, satellites }) => {
    const { frame, backdrop } = placeImage(host, face);
    return [host, ...satellites].map(ring => ({ ring, frame, backdrop }));
  });
}

// Biggest first, a ring at most 1/5 of a host's area and closer to it than
// 1/5 of the host's size becomes its satellite; any other ring is a host
function groupSatellites(rings) {
  const groups = [];
  for (const ring of [...rings].sort((a, b) => b.area - a.area)) {
    const box = shiftedBox(ring);
    let closest = null, closestGap = Infinity;
    for (const group of groups) {
      const hostBox = shiftedBox(group.host);
      const gap = boxGap(hostBox, box);
      const hostSize = Math.max(hostBox.x1 - hostBox.x0, hostBox.y1 - hostBox.y0);
      if (ring.area <= group.host.area / 5 && gap <= hostSize / 5 && gap < closestGap) {
        closest = group;
        closestGap = gap;
      }
    }
    if (closest) closest.satellites.push(ring);
    else groups.push({ host: ring, satellites: [] });
  }
  return groups;
}

// Picks the image size and position. An image without a face covers the ring,
// its middle on the ring's pole of inaccessibility. Otherwise the face goes
// there, and the first size from ZOOMS that shows most of the face on land
// wins. Small faces are zoomed in first, so they don't drown in background.
function placeImage(ring, face) {
  const box = shiftedBox(ring);
  const cover = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const label = polylabel(ring.points, ring.box);
  const anchor = { x: label.x + ring.shift, y: label.y };
  // The image at the given size, with its point (px, py) on the anchor
  const frameAt = (size, px, py) => {
    let x0 = anchor.x - px * size;
    let y1 = anchor.y + py * size;
    if (size >= cover) {
      // Still cover the whole ring
      x0 = clamp(x0, box.x1 - size, box.x0);
      y1 = clamp(y1, box.y1, box.y0 + size);
    }
    return { x0, y1, size };
  };
  if (!face) return { frame: frameAt(cover, 0.5, 0.5), backdrop: null };

  const [fx, fy, fw, fh] = face;
  const faceZoom = Math.min(3, (2 * label.radius) / (2.5 * Math.max(fw, fh)) / cover);
  let best = null;
  for (const zoom of faceZoom > 1 ? [faceZoom, ...ZOOMS] : ZOOMS) {
    const frame = frameAt(cover * zoom, fx + fw / 2, fy + fh / 2);
    const visible = faceVisibility(frame, face, ring);
    if (!best || visible > best.visible + 0.05) best = { frame, visible, zoom };
    if (visible >= MIN_FACE_VISIBLE) {
      best = { frame, visible, zoom };
      break;
    }
  }
  // Mirrored copies continue a slightly shrunk image; a much smaller one would
  // mirror the face too, so it sits on a blurred copy of the covering image instead
  const backdrop = best.zoom < 0.5 ? frameAt(cover, fx + fw / 2, fy + fh / 2) : null;
  return { frame: best.frame, backdrop };
}

// Share of the face box that lands inside the ring
function faceVisibility(frame, [fx, fy, fw, fh], ring) {
  const n = 7;
  let inside = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = frame.x0 + (fx + fw * (i + 0.5) / n) * frame.size - ring.shift;
      const y = frame.y1 - (fy + fh * (j + 0.5) / n) * frame.size;
      if (signedDistance(x, y, ring.points) > 0) inside++;
    }
  }
  return inside / (n * n);
}

async function drawRing(ring, frame, backdrop, src) {
  const box = shiftedBox(ring);
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  // As many pixels as the image has over this box, at most 1024 on the long side
  const density = Math.min(src.width / frame.size, 1024 / Math.max(w, h));
  const cw = Math.max(2, Math.round(w * density));
  const ch = Math.max(2, Math.round(h * density));
  const kx = cw / w, ky = ch / h;
  const place = (f) => [(f.x0 - box.x0) * kx, (box.y1 - f.y1) * ky, f.size * kx, f.size * ky];

  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ring.points.forEach(([x, y], i) => {
    const px = (x + ring.shift - box.x0) * kx;
    const py = (box.y1 - y) * ky;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.clip();

  if (!backdrop) {
    drawMirrored(ctx, src, place(frame), cw, ch);
    return canvas.convertToBlob();
  }
  // Blurred by drawing it tiny and scaling it back up
  const blur = new OffscreenCanvas(Math.max(1, Math.round(cw / 24)), Math.max(1, Math.round(ch / 24)));
  const bctx = blur.getContext('2d');
  bctx.scale(blur.width / cw, blur.height / ch);
  drawMirrored(bctx, src, place(backdrop), cw, ch);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(blur, 0, 0, cw, ch);
  // The sharp image on top, its edges faded into the blur
  const layer = new OffscreenCanvas(cw, ch);
  const lctx = layer.getContext('2d');
  const [dx, dy, dw, dh] = place(frame);
  lctx.drawImage(src.bitmap, src.x, src.y, src.width, src.height, dx, dy, dw, dh);
  fadeEdges(lctx, dx, dy, dw, dh, Math.max(2, dw * 0.08));
  ctx.drawImage(layer, 0, 0);
  return canvas.convertToBlob();
}

// Draws the image at [dx, dy, dw, dh], continued past its edges by mirrored
// copies so a ring sticking out of it is still filled
function drawMirrored(ctx, src, [dx, dy, dw, dh], cw, ch) {
  const i0 = Math.max(-3, Math.floor(-dx / dw)), i1 = Math.min(3, Math.ceil((cw - dx) / dw) - 1);
  const j0 = Math.max(-3, Math.floor(-dy / dh)), j1 = Math.min(3, Math.ceil((ch - dy) / dh) - 1);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const flipX = i % 2 !== 0, flipY = j % 2 !== 0;
      ctx.save();
      ctx.translate(dx + i * dw + (flipX ? dw : 0), dy + j * dh + (flipY ? dh : 0));
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(src.bitmap, src.x, src.y, src.width, src.height, 0, 0, dw, dh);
      ctx.restore();
    }
  }
}

function fadeEdges(ctx, x, y, w, h, f) {
  ctx.globalCompositeOperation = 'destination-out';
  const edges = [
    [x, y, x + f, y, x, y, f, h],
    [x + w, y, x + w - f, y, x + w - f, y, f, h],
    [x, y, x, y + f, x, y, w, f],
    [x, y + h, x, y + h - f, x, y + h - f, w, f]
  ];
  for (const [gx0, gy0, gx1, gy1, rx, ry, rw, rh] of edges) {
    const gradient = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    gradient.addColorStop(0, '#000');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.globalCompositeOperation = 'source-over';
}

const MAX_LATITUDE = 85.0511;
const WORLD_WIDTH = 2 * Math.PI * 6378137;

function prepareRing(lonLat) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of lonLat) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  minLat = Math.max(minLat, -MAX_LATITUDE);
  maxLat = Math.min(maxLat, MAX_LATITUDE);
  const points = lonLat.map(([lon, lat]) => mercator(lon, clamp(lat, -MAX_LATITUDE, MAX_LATITUDE)));
  const [x0, y1] = mercator(minLon, maxLat), [x1, y0] = mercator(maxLon, minLat);
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j][0] - points[i][0]) * (points[j][1] + points[i][1]);
  }
  return {
    points,
    box: { x0, y0, x1, y1 },
    area: Math.abs(area / 2),
    shift: 0,
    coordinates: [[minLon, maxLat], [maxLon, maxLat], [maxLon, minLat], [minLon, minLat]]
  };
}

function closestCopy(ring, main) {
  const center = (r) => (r.box.x0 + r.box.x1) / 2;
  const offset = center(main) - center(ring);
  return Math.round(offset / WORLD_WIDTH) * WORLD_WIDTH;
}

function shiftedBox({ box, shift }) {
  return { x0: box.x0 + shift, x1: box.x1 + shift, y0: box.y0, y1: box.y1 };
}

function boxGap(a, b) {
  return Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
}

// Pole of inaccessibility: the inside point farthest from the outline, found
// by refining a grid around the best point. Returns { x, y, radius }.
function polylabel(points, box) {
  let span = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  let best = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, radius: -Infinity };
  for (let pass = 0; pass < 4; pass++) {
    const step = span / (pass === 0 ? 24 : 12);
    const { x: cx, y: cy } = best;
    for (let x = cx - span / 2; x <= cx + span / 2; x += step) {
      for (let y = cy - span / 2; y <= cy + span / 2; y += step) {
        const radius = signedDistance(x, y, points);
        if (radius > best.radius) best = { x, y, radius };
      }
    }
    span = step * 3;
  }
  return { ...best, radius: Math.max(best.radius, 0) };
}

// Distance to the outline, negative outside
function signedDistance(x, y, points) {
  let inside = false, min = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
    min = Math.min(min, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return inside ? min : -min;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function mercator(lon, lat) {
  const R = 6378137;
  const DEG = Math.PI / 180;
  const sin = Math.sin(lat * DEG);
  return [R * lon * DEG, R * Math.log((1 + sin) / (1 - sin)) / 2];
}
