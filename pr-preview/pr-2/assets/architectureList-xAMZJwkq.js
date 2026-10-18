import"./modulepreload-polyfill-P2Xu9kJm.js";var e=null;function t(t){e=t,n().then(r)}function n(){return fetch(`../ne_110m_admin_0_countries.geojson`).then(e=>e.json())}function r(e){let t=document.querySelector(`.list`);for(let n of e.features){let e=i(n.properties.admin);t.appendChild(e)}}function i(e){if(!e)return;let t=`
    <h2 class='query-title'>${e}</h2>
    <div class="imgContainer">
      <a href="${a(e)}" target="_blank" class="result-open">
        <img src="${a(e)}" width="2048" height="2048" loading="lazy" alt="Futuristic architecture of ${e}" />
      </a>
    </div>
    <code>/imagine prompt:"Futuristic architecture of <b>${e}</b>"</code>
    <hr />
  `,n=document.createElement(`div`);return n.innerHTML=t,n.style.display=`block`,n.scrollTop=0,n}function a(t){return`../images-small/`+e+`/`+t.replace(/ /g,`_`)+`.webp`}t(`architecture`);