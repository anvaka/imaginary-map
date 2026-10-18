import { createClipQueue } from './clipQueue.js';

// Images are decoded, clipped and encoded in workers so the main thread stays responsive
const WORKER_COUNT = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
// Widths of one Midjourney candidate on the map, in pixels; the last one is the
// original, a quadrant of the 2048px grid. Smaller sizes come from scripts/make-sizes.py.
const IMAGE_SIZES = [256, 512, 1024];
// Matches maplibre's default paint transition, used to fade images in
const FADE_MS = 300;
// Every page is a folder under the site root, which has the images and the borders
const ROOT = '../';
const FULL_IMAGE = { x: 0, y: 0, width: 1, height: 1 };

const countries = new Map();
// The folder of images the page shows, e.g. architecture
let kind = null;
// Countries still waiting for their first image, if any
let loading = null;

const map = new maplibregl.Map({
  container: 'map',
  zoom: 1,
  minZoom: 1,
  pitchWithRotate: false,
  layers: []
});
map.dragRotate.disable();
map.touchZoomRotate.disableRotation();

const clipQueue = createClipQueue(WORKER_COUNT);
// Callbacks for image sources maplibre hasn't loaded yet, by source id
const sourceWaiters = new Map();
map.on('sourcedata', (e) => {
  if (e.isSourceLoaded) sourceWaiters.get(e.sourceId)?.();
});

export function showMap(imageKind) {
  kind = imageKind;
  loadBorders().then(initMap);
}

function loadBorders() {
  const bounds = 'ne_110m_admin_0_countries.geojson';
  return fetch(ROOT + bounds).then(res => res.json());
}

function initMap(borders) {
  map.addSource("borders", { "type": "geojson", "data": borders });
  map.addLayer({
    "id": "country-backgrounds",
    "type": "fill",
    "source": "borders",
    "paint": { "fill-opacity": 0.0 },
  });

  map.addLayer({
    "id": "borders",
    "type": "line",
    "source": "borders",
    "paint": { "line-color": "#ffffff", "line-width": 1 },
  });

  for (const countryPolygon of borders.features) {
    const rings = getOuterRings(countryPolygon);
    countries.set(countryPolygon.properties.admin, {
      country: countryPolygon.properties.admin,
      rings,
      ringBounds: rings.map(getRingBounds),
      // Which of Midjourney's four candidates is shown, picked per country in the sidebar
      quadrant: 0,
      // Layers on the map and the image size they show
      shown: { keys: [], size: 0 },
      // Replaced layers still under the new ones while those fade in
      retiring: [],
      // Size of a sharper image being loaded, if any
      sharpening: 0,
      // Bumped whenever the country's image changes, to drop results of older requests
      generation: 0
    });
  }
  loadAll();

  map.on('moveend', () => {
    // While the first images load, the countries now on screen go first
    if (loading) loading.forEach(country => clipQueue.setPriority(country, loadPriority(countries.get(country))));
    else sharpenVisible();
  });
  map.on('click', function (e) {
    let features = map.queryRenderedFeatures(e.point, {layers: ['country-backgrounds']});
    if (!features.length) return;
    renderSideBar(features[0].properties.admin)
  });
}

// Loads the smallest image of every country, the ones on screen first, then
// sharper ones for the countries drawn big enough to need them
function loadAll() {
  loading = new Set(countries.keys());
  for (const info of countries.values()) loadFirst(info);
}

function loadFirst(info) {
  const generation = ++info.generation;
  loadImage(info, IMAGE_SIZES[0], loadPriority(info)).then(keys => {
    if (keys === null || generation !== info.generation) return;
    swapIn(info, keys, IMAGE_SIZES[0]);
    loading.delete(info.country);
    if (!loading.size) {
      loading = null;
      sharpenVisible();
    }
  });
}

// The countries on screen load first, the biggest of them first
function loadPriority(info) {
  const { visible, pixels } = getScreenSize(info);
  return visible ? 1 / (1 + pixels) : 1;
}

// Swaps in sharper images for countries that are on screen and drawn bigger
// than their current image, the biggest first
function sharpenVisible() {
  if (loading) return;
  const pixelRatio = window.devicePixelRatio || 1;
  for (const info of countries.values()) {
    const { visible, pixels } = getScreenSize(info);
    if (!visible) continue;
    // Allow some upscaling before fetching the next size
    const size = IMAGE_SIZES.find(s => s >= pixels * pixelRatio * 0.8) || IMAGE_SIZES[IMAGE_SIZES.length - 1];
    if (size <= Math.max(info.shown.size, info.sharpening)) continue;
    showImage(info, size, 2 + 1 / pixels);
  }
}

// Replaces one country's image, keeping the old one until the new one is loaded
function showImage(info, size, priority) {
  const generation = ++info.generation;
  info.sharpening = size;
  loadImage(info, size, priority).then(keys => {
    if (keys === null || generation !== info.generation) return;
    swapIn(info, keys, size);
    info.sharpening = 0;
  });
}

// Fades the country's new layers in over its current ones, then removes those,
// so the country never shows the background in between
function swapIn(info, keys, size) {
  const old = info.shown.keys;
  keys.forEach(key => map.setPaintProperty(key, 'raster-opacity', 1));
  info.shown = { keys, size };
  if (!old.length) return;
  info.retiring.push(...old);
  // A little past the fade, since it starts on the next frame
  setTimeout(() => {
    removeLayers(old);
    info.retiring = info.retiring.filter(key => !old.includes(key));
  }, FADE_MS + 100);
}

// Clips the country's image at the given size and adds it to the map, hidden.
// Resolves to the new layer ids once maplibre has loaded them, or to null if a
// newer request for the country came in meanwhile.
async function loadImage(info, size, priority) {
  const generation = info.generation;
  const { quadrant } = info;
  const { url, crop } = quadrantImage(info.country, quadrant, size);
  let results;
  try {
    // Keyed by country, so this cancels any earlier request for it that hasn't finished
    results = await clipQueue.clip(info.country, { url, crop, rings: info.rings }, priority);
  } catch (err) {
    console.error(`Failed to load ${info.country}`, err);
    results = [];
  }
  if (!results || generation !== info.generation) return null;

  const keys = results.map(({ blob, coordinates }, polyIndex) =>
    addImageLayer(`image-${info.country}-${quadrant}-${size}-${polyIndex}-${generation}`, blob, coordinates));
  await Promise.all(keys.map(whenSourceLoaded));
  if (generation !== info.generation) {
    removeLayers(keys);
    return null;
  }
  return keys;
}

// Layers start hidden, and swapIn fades them in. Maplibre's own fade-in of new
// raster images is off: it starts from transparent, which made a replaced
// image flash the background.
function addImageLayer(key, blob, coordinates) {
  const url = URL.createObjectURL(blob);
  map.addSource(key, { "type": "image", "url": url, "coordinates": coordinates });
  map.addLayer({
    "id": key,
    "type": "raster",
    "source": key,
    "paint": { "raster-opacity": 0, "raster-fade-duration": 0 }
  }, 'borders');
  const loaded = new Promise(resolve => sourceWaiters.set(key, resolve));
  loaded.then(() => {
    sourceWaiters.delete(key);
    URL.revokeObjectURL(url);
  });
  return key;
}

function whenSourceLoaded(key) {
  return new Promise(resolve => {
    const done = sourceWaiters.get(key);
    if (!done) return resolve();
    sourceWaiters.set(key, () => { done(); resolve(); });
  });
}

function removeLayers(keys) {
  for (const key of keys) {
    if (!map.getLayer(key)) continue;
    map.removeLayer(key);
    map.removeSource(key);
    // Lets anything waiting on this source move on
    sourceWaiters.get(key)?.();
  }
}

// Where the country is on screen: whether any part of it is visible, and how
// many CSS pixels its biggest visible polygon spans
function getScreenSize(info) {
  const { clientWidth: width, clientHeight: height } = map.getCanvas();
  let visible = false;
  let pixels = 0;
  for (const [[minLon, minLat], [maxLon, maxLat]] of info.ringBounds) {
    const topLeft = map.project([minLon, maxLat]);
    const bottomRight = map.project([maxLon, minLat]);
    if (bottomRight.x < 0 || topLeft.x > width || bottomRight.y < 0 || topLeft.y > height) continue;
    visible = true;
    pixels = Math.max(pixels, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }
  return { visible, pixels };
}

function getRingBounds(ring) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return [[minLon, minLat], [maxLon, maxLat]];
}

function getOuterRings(countryPolygon) {
  const { type, coordinates } = countryPolygon.geometry;
  if (type === "MultiPolygon") return coordinates.map(polygon => polygon[0]);
  if (type === "Polygon") return [coordinates[0]];
  return [];
}

function renderSideBar(countryName) {
  if (!countryName) return;
  let prompt = window.mapCountryToPrompt(countryName)
  let content = `
    <h3 class='query-title'>Query sent to <a href="https://www.midjourney.com/">Midjourney</a>
    <a href='#' class='close'>[x]</a>
    </h3>
    <code>${prompt}</code>
    <div style="width:100%; position: relative;" class="imgContainer">
      <img src="${getImageUrl(countryName)}" alt="${countryName}" />
      <div class="quadrant-border"></div>
    </div>
    <a href="${getImageUrl(countryName)}" target="_blank" class="result-open">Open image in new tab</a>
    <hr />
    <iframe src="https://en.m.wikipedia.org/wiki/${countryName}" width="100%" height="100%" frameborder="0"></iframe>
  `;
  let sidebar = document.querySelector('#sidebar');
  sidebar.innerHTML = content;
  sidebar.style.display = 'block';
  sidebar.scrollTop = 0;
  sidebar.querySelector('.close').addEventListener('click', (e) => {
    e.preventDefault();
    sidebar.innerHTML = '';
    sidebar.style.display = 'none';
  });

  const mainImage = sidebar.querySelector('.imgContainer');
  const quadrantBorder = sidebar.querySelector('.quadrant-border');
  // mainImage has four quadrants, we want to highlight each one as mouse enters over it
  mainImage.addEventListener('mousemove', (e) => {
    const { quadrant, width, height } = getQuadrant(e, mainImage);
    quadrantBorder.style.left = (quadrant % 2 === 0 ? 0 : width/2) + 'px';
    quadrantBorder.style.top = (quadrant < 2 ? 0 : height/2) + 'px';
    quadrantBorder.style.width = width/2 + 'px';
    quadrantBorder.style.height = height/2 + 'px';
    quadrantBorder.style.border = '2px solid #fff';
    quadrantBorder.style.position = 'absolute';
  });
  mainImage.addEventListener('mouseleave', (e) => {
    quadrantBorder.style.border = 'none';
  });
  mainImage.addEventListener('click', (e) => {
    const { quadrant } = getQuadrant(e, mainImage);
    if (quadrant < 0 || quadrant > 3) throw new Error('Invalid quadrant');

    const countryInfo = countries.get(countryName);
    if (!countryInfo || countryInfo.quadrant === quadrant) return;
    countryInfo.quadrant = quadrant;
    if (loading?.has(countryName)) loadFirst(countryInfo);
    else showImage(countryInfo, Math.max(countryInfo.shown.size, IMAGE_SIZES[0]), 0);
    if (window.innerWidth < 600) {
      sidebar.innerHTML = '';
      sidebar.style.display = 'none';
    }
  });

  function getQuadrant(e, mainImage) {
    const clientRect = mainImage.getBoundingClientRect();
    const x = e.clientX - clientRect.left;
    const y = e.clientY - clientRect.top;
    const width = clientRect.width;
    const height = clientRect.height;
    return {quadrant: (x < width/2 ? 0 : 1) + (y < height/2 ? 0 : 2), width, height};
  }
}

function getImageUrl(adminName) {
  return ROOT + 'images-small/' + kind + '/' + fileName(adminName) + '.webp';
}

// One of the four candidates at the given size: the URL of a file and the part
// of it to clip. Smaller sizes have a file per quadrant; the original size is
// cut from the grid.
function quadrantImage(adminName, quadrant, size) {
  if (size < IMAGE_SIZES[IMAGE_SIZES.length - 1]) {
    return { url: `${ROOT}images-small/${kind}/${size}/${fileName(adminName)}-${quadrant}.webp`, crop: FULL_IMAGE };
  }
  const crop = { x: (quadrant % 2) / 2, y: Math.floor(quadrant / 2) / 2, width: 0.5, height: 0.5 };
  return { url: getImageUrl(adminName), crop };
}

function fileName(adminName) {
  return adminName.replace(/ /g, '_');
}
