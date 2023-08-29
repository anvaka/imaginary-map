import getImage from "./imageLayer.js";

const scriptAddress = import.meta.url;
const baseAddress = scriptAddress.substring(0, scriptAddress.lastIndexOf('/')) + '/';
const kind = new URL(import.meta.url).searchParams.get('kind') || 'architecture';

loadBorders().then(renderList);

function loadBorders() {
  const bounds = 'ne_110m_admin_0_countries.geojson';
  return fetch(baseAddress + bounds).then(res => res.json());
}

function renderList(borders) {
  const list = document.querySelector('.list');
  for (let countryPolygon of borders.features) {
    const div = getCountryDiv(countryPolygon.properties.admin)
    list.appendChild(div);
  }

}


function getCountryDiv(countryName) {
  if (!countryName) return;
  let content = `
    <h2 class='query-title'>${countryName}</h2>
    <div class="imgContainer">
      <a href="${getImageUrl(countryName)}" target="_blank" class="result-open">
        <img src="${getImageUrl(countryName)}" alt="Futuristic architecture of ${countryName}" />
      </a>
    </div>
    <code>/imagine prompt:"Futuristic architecture of <b>${countryName}</b>"</code>
    <hr />
  `;
  let countryDiv = document.createElement('div');
  countryDiv.innerHTML = content;
  countryDiv.style.display = 'block';
  countryDiv.scrollTop = 0;
  return countryDiv;
}

function getImageUrl(adminName) {
  return baseAddress + 'images-small/' + kind + '/' + adminName.replace(/ /g, '_') + '.webp';
}