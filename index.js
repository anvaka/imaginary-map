import getImage from "./imageLayer.js";

const loadedImages = new Map();
const scriptAddress = import.meta.url;
const baseAddress = scriptAddress.substring(0, scriptAddress.lastIndexOf('/')) + '/';
const kind = new URL(import.meta.url).searchParams.get('kind') || 'architecture';

const map = new maplibregl.Map({
  container: 'map',
  zoom: 1,
  minZoom: 1,
  pitchWithRotate: false,
  layers: []
});
map.dragRotate.disable();
map.touchZoomRotate.disableRotation();

loadBorders().then(initMap);

function loadBorders() {
  const bounds = 'ne_110m_admin_0_countries.geojson';
  return fetch(baseAddress + bounds).then(res => res.json());
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

  loadNextCountry(0, borders);

  map.on('click', function (e) {
    let features = map.queryRenderedFeatures(e.point, {layers: ['country-backgrounds']});
    if (!features.length) return;
    renderSideBar(features[0].properties.admin)
  });
}

function loadNextCountry(countryIndex, borders) {
  let countryPolygon = borders.features[countryIndex];
  if (!countryPolygon) return;

  const countryInfo = {
    quadrant: 0,
    countryPolygon,
    image: getImageUrl(countryPolygon.properties.admin),
    loadedKeys: []
  };

  if (!countryInfo.image) return;
  loadedImages.set(countryPolygon.properties.admin, countryInfo);
  loadSingleCountry(countryInfo).then(() => loadNextCountry(countryIndex + 1, borders));
}

function loadSingleCountry(countryInfo) {
  const {countryPolygon, image, quadrant} = countryInfo;
  if (countryPolygon.geometry.type === "MultiPolygon") {
    return Promise.all(getAllPolygons(countryPolygon).map((polygon, polyIndex) => {
      return addImage(image, polygon, quadrant, polyIndex);
    }));
  } else if (countryPolygon.geometry.type === "Polygon") {
    return addImage(image, countryPolygon, quadrant, 0);
  }
}

async function addImage(imageSrc, countryPolygon, variant, polyIndex) {
  if (countryPolygon.geometry.type !== "Polygon") {
    throw new Error('Unsupported polygon type')
  }

  const img = await clipImage(imageSrc, countryPolygon.geometry.coordinates[0], variant);
  const imgKey = `image-${countryPolygon.properties.admin}-${variant}${polyIndex}`;

  map.addSource(imgKey, {
    "type": "image",
    "url": img.canvas.toDataURL(),
    "coordinates": img.coordinates
  });

  map.addLayer({
    "id": imgKey,
    "type": "raster",
    "source": imgKey,
    "paint": { "raster-opacity": 1 }
  }, 'borders');

  loadedImages.get(countryPolygon.properties.admin).loadedKeys.push(imgKey);
  return img;
}

async function clipImage(url, coordinates, variant = 0) {
  let img = await getImage(url);

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (let coord of coordinates) {
    if (coord[0] < minLon) minLon = coord[0];
    if (coord[1] < minLat) minLat = coord[1];
    if (coord[0] > maxLon) maxLon = coord[0];
    if (coord[1] > maxLat) maxLat = coord[1];
  }
  const MAX_LATITUDE = 85.0511;
  const MIN_LATITUDE = -85.0511;
  minLat = Math.max(minLat, MIN_LATITUDE);
  maxLat = Math.min(maxLat, MAX_LATITUDE);

  const topLeft = mercator(minLon, maxLat);
  const bottomRight = mercator(maxLon, minLat);

  // Create canvas and context
  const canvas = document.createElement('canvas');
  let width = canvas.width = img.width/2;
  let height = canvas.height = img.height/2;

  const ctx = canvas.getContext('2d');

  clipContextToPolygon(ctx, coordinates, (pair) => {
    let projected = mercator(pair[0], pair[1]);
    return {
      x: (projected.x - topLeft.x) / (bottomRight.x - topLeft.x) * width, 
      y: (projected.y - topLeft.y) / (bottomRight.y - topLeft.y) * height
    };
  });

  // Draw the image
  let sx = 0, sy = 0;
  if (variant === 1 || variant === 3) sx += width;
  if (variant === 2 || variant === 3) sy += height;

  
  ctx.drawImage(img.img, sx, sy, width, height, 0, 0, width, height);
  let imageCoordinates = [
    [minLon, maxLat],
    [maxLon, maxLat],
    [maxLon, minLat],
    [minLon, minLat]
  ];

  return { canvas, coordinates: imageCoordinates };
}

function clipContextToPolygon(ctx, coordinates, project) {
  ctx.beginPath();

  var first = true;
  for (var pair of coordinates) {
    const p = project(pair);

    if (first) {
      ctx.moveTo(p.x, p.y);
      first = false;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }

  ctx.closePath();
  ctx.clip();
}

function getAllPolygons(multiPolygon) {
  return multiPolygon.geometry.coordinates.map(polygon => ({
    geometry: {
      type: "Polygon",
      coordinates: polygon
    },
    properties: multiPolygon.properties,
  }));
}

function mercator(lon, lat) {
    const R = 6378137;  // Earth radius
    const DEG = Math.PI / 180;

    const sin = Math.sin(lat * DEG);
    if (Math.abs(sin) > 1) sin = Math.sign(sin);

    // Mercator projection
    const y = R * Math.log((1 + sin) / (1 - sin)) / 2;
    const x = R * lon * DEG;

    return { x: x, y: y };
}

function renderSideBar(countryName) {
  if (!countryName) return;
  let content = `
    <h3 class='query-title'>Query sent to <a href="https://www.midjourney.com/">Midjourney</a>
    <a href='#' class='close'>[x]</a>
    </h3>
    <code>/imagine prompt:"Futuristic architecture of <b>${countryName}</b>"</code>
    <div style="width:100%; position: relative;" class="imgContainer">
      <img src="${getImageUrl(countryName)}" alt="Futuristic architecture of ${countryName}" />
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

    const countryInfo = loadedImages.get(countryName);
    if (!countryInfo || countryInfo.quadrant === quadrant) return;
    countryInfo.quadrant = quadrant;
    countryInfo.loadedKeys.forEach(key => {
      // delete old sources/layers for this key:
      map.removeLayer(key);
      map.removeSource(key);
    });
    countryInfo.quadrant = quadrant;
    countryInfo.loadedKeys = [];
    loadSingleCountry(countryInfo);
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
  return baseAddress + 'images-small/' + kind + '/' + adminName.replace(/ /g, '_') + '.webp';
}