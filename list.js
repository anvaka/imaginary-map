// Every page is a folder under the site root, which has the images and the borders
const ROOT = '../';
// The folder of images the page shows, e.g. architecture
let kind = null;

export function showList(imageKind) {
  kind = imageKind;
  loadBorders().then(renderList);
}

function loadBorders() {
  const bounds = 'ne_110m_admin_0_countries.geojson';
  return fetch(ROOT + bounds).then(res => res.json());
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
  // Lazy, so only the images near the screen download, not all of them at once
  let content = `
    <h2 class='query-title'>${countryName}</h2>
    <div class="imgContainer">
      <a href="${getImageUrl(countryName)}" target="_blank" class="result-open">
        <img src="${getImageUrl(countryName)}" width="2048" height="2048" loading="lazy" alt="Futuristic architecture of ${countryName}" />
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
  return ROOT + 'images-small/' + kind + '/' + adminName.replace(/ /g, '_') + '.webp';
}
