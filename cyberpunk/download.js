const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const work = require('./workIds.json');

(async () => {
  const browser = await puppeteer.launch({headless: false});
  const page = await browser.newPage();

  for (let i = 0; i < work.length; i++) {
    const workId = work[i];
    const response = await page.goto(`https://cdn.midjourney.com/${workId.id}/grid_0.webp`, {
      waitUntil: 'load'
    });
    const [name, country] = workId.query.split(' in cyberpunk settings. ');

    // Get the image buffer
    const buffer = await response.buffer();

    const originalPath = `../images-small/cyberpunk/original/${country}.webp`;
    // Save the image buffer to a file
    await fs.writeFile(originalPath, buffer);

    // Minimize the image using Squoosh CLI
    // npx @squoosh/cli --webp '{"quality":75,"target_size":0,"target_PSNR":0,"method":4,"sns_strength":50,"filter_strength":60,"filter_sharpness":0,"filter_type":1,"partitions":0,"segments":4,"pass":1,"show_compressed":0,"preprocessing":0,"autofilter":0,"partition_limit":0,"alpha_compression":1,"alpha_filtering":1,"alpha_quality":100,"lossless":0,"exact":0,"image_hint":0,"emulate_jpeg_size":0,"thread_level":0,"low_memory":0,"near_lossless":100,"use_delta_palette":0,"use_sharp_yuv":0}' original/*.webp -d images-small
  }

  await browser.close();
})();
