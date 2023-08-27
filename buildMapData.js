const query = 'Futuristic architecture of <X>';
const output = 'images-small/architecture/';

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const originalImages = path.join(output, 'original');
let lastProcessed = 0;

const borders = JSON.parse(fs.readFileSync('./ne_110m_admin_0_countries.geojson', 'utf8'));

const missing = [];
for (let countryPolygon of borders.features) {
  const countryName = countryPolygon.properties.admin;
  const name = normalize(countryName)
  if (!fs.existsSync(`${output}${name}.webp`)) {
    missing.push({
      outputName: name,
      countryName,
    });
  }
}

processNextMissing(0)

function processNextMissing(index) {
  if (index >= missing.length) return;
  lastProcessed = index;

  const {outputName, countryName} = missing[index];
  const typeQuery = query.replace('<X>', countryName);
  console.log(`/imagine prompt:"${typeQuery}"`);

  readImageUrl().then(downloadImage).then((filePath) => convertToWebp(filePath, outputName)).then(() => {
    processNextMissing(index + 1);
  })
}

function getNextQuery() {
  let next = missing[lastProcessed + 1];
  if (!next) return;
  const {outputName, countryName} = next;
  const typeQuery = query.replace('<X>', countryName);
  return `/imagine prompt:"${typeQuery}"`;
}

function normalize(name) {
  return name.replace(/ /g, '_');
}

function readImageUrl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve, reject) => {
    const progress = 'Progress: ' + (lastProcessed + 1) + '/' + missing.length;
    console.log(progress)
    rl.question('Please enter the image URL: ', (answer) => {
      rl.close();
      const nextQuery = getNextQuery();
      if (nextQuery) {
        copyQueryToClipboard(nextQuery);
      }
      resolve(answer);
    });
  });
}

function downloadImage(url) {
  const https = require('https');
  const fs = require('fs');
  const path = require('path');

  return new Promise((resolve, reject) => {
    const imageName = path.basename(url);
    const fullFilePath = path.join(originalImages, imageName);
    const file = fs.createWriteStream(fullFilePath);
    https.get(url, function(response) {
      response.pipe(file);
      file.on('finish', function() {
        file.close(() => resolve(fullFilePath));
      });
    }).on('error', function(err) { // Handle errors
      console.log(err);
      fs.unlink(dest); // Delete the file async. (But we don't check the result)
      reject(err.message);
    });
  });
  
}

function convertToWebp(filePath, desiredCountryName) {
  const { exec } = require('child_process');
  const webpOptions = '{"quality":75,"target_size":0,"target_PSNR":0,"method":4,"sns_strength":50,"filter_strength":60,"filter_sharpness":0,"filter_type":1,"partitions":0,"segments":4,"pass":1,"show_compressed":0,"preprocessing":0,"autofilter":0,"partition_limit":0,"alpha_compression":1,"alpha_filtering":1,"alpha_quality":100,"lossless":0,"exact":0,"image_hint":0,"emulate_jpeg_size":0,"thread_level":0,"low_memory":0,"near_lossless":100,"use_delta_palette":0,"use_sharp_yuv":0}';
  const command = `npx @squoosh/cli --webp '${webpOptions}' ${filePath} -d ${output}`;

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.log(`error: ${error.message}`);
        return reject(error);
      }
      if (stderr) {
        console.log(`stderr: ${stderr}`);
      }
      const fileName = path.basename(filePath);
      const webpFileName = fileName.replace(path.extname(fileName), '.webp');
      const fullWebpFilePath = path.join(output, webpFileName);
      const outputFilePath = `${output}${desiredCountryName}.webp`;
      fs.renameSync(fullWebpFilePath, outputFilePath);
      resolve(outputFilePath);
    });
  });
}

function copyQueryToClipboard(query) {
  const { exec } = require('child_process');
  const command = `echo "${query}" | pbcopy`;
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.log(`error: ${error.message}`);
      return reject(error);
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`);
    }
  });
}