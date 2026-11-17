import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const fixturePath = new URL('../ace-intake-smoke.html', import.meta.url);
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main class="app"><div id="root"></div></main><script type="module">' +
  'import React from "react"; import {createRoot} from "react-dom/client";' +
  'import AcePaceIntake from "/src/AcePaceIntake.jsx"; import {aceStickerItem} from "/src/acePace.js"; import "/src/App.css";' +
  'window.acePrints=[]; createRoot(document.getElementById("root")).render(React.createElement(AcePaceIntake,{' +
  'onClose:()=>{},onSaved:async()=>{},syncSquare:async()=>{},generateSku:async()=>"ILHRC-999999",' +
  'uploadPhoto:async file=>{window.aceUploaded={type:file.type,size:file.size};return "https://ace-test.supabase.co/storage/v1/object/public/book-covers/test.jpg";},' +
  'onPrint:item=>window.acePrints.push(aceStickerItem(item))}));</script></body></html>';
await writeFile(fixturePath, html);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: 'https://ace-test.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
});
let browser;
try {
  let started = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { started = (await fetch('http://127.0.0.1:4174/ace-intake-smoke.html')).ok; } catch {}
    if (started) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(started, 'Vite smoke fixture starts');
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let savedPayload;
  await page.route('https://ace-test.supabase.co/**', async route => {
    const url = route.request().url();
    let body;
    if (url.includes('/ace_pricing')) body = { prices: { complete: 8, older: 5, individual: .75, partial: .5, scoreKey: 1, test: .25 } };
    else if (url.includes('/rpc/receive_ace_intake')) {
      const request = route.request().postDataJSON();
      savedPayload = request.p_item;
      body = { ...request.p_item, id: 100, sku: request.p_item.sku || 'ILHRC-999999', quantity: request.p_quantity, received_quantity: request.p_quantity };
    } else if (url.includes('/storage/')) {
      await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcGoAAAAASUVORK5CYII=', 'base64') });
      return;
    } else body = [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('http://127.0.0.1:4174/ace-intake-smoke.html');
  await page.getByRole('combobox', { name: 'Grade / Level' }).selectOption('5');
  assert.equal(await page.getByRole('combobox', { name: 'Grade / Level' }).inputValue(), '5');
  assert.equal(await page.getByLabel('1049', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('1060', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('Edition', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Older-edition pricing category').count(), 0);
  assert.equal(await page.locator('dialog').count(), 0);
  assert.equal(await page.getByRole('combobox', { name: 'Grade / Level' }).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');

  await page.getByRole('button', { name: 'Take Photo', exact: true }).click();
  await page.getByRole('button', { name: 'Use This Photo' }).click();
  await page.getByAltText('ACE listing photo preview').waitFor();
  await page.getByRole('textbox', { name: 'Listing SKU' }).fill('ace-math-5');
  await page.getByLabel('All 12 student PACEs are present').check();
  await page.getByRole('button', { name: 'Save & Print Sticker', exact: true }).click();
  await page.getByRole('button', { name: /Print Sticker - ACE-MATH-5/ }).waitFor();
  assert.equal(savedPayload.sku, 'ACE-MATH-5');
  assert.equal(savedPayload.image_url, 'https://ace-test.supabase.co/storage/v1/object/public/book-covers/test.jpg');
  assert.equal(savedPayload.ace_details.numbers.length, 12);
  assert.ok((await page.evaluate(() => window.aceUploaded)).size > 0);
  assert.equal(await page.evaluate(() => window.acePrints[0].label_quantity), 1);
  await page.getByRole('button', { name: 'Add Another Listing' }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Listing SKU' }).inputValue(), '');
  assert.equal(await page.getByAltText('ACE listing photo preview').count(), 0);
  await page.getByRole('button', { name: 'Generate SKU', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Listing SKU' }).inputValue(), 'ILHRC-999999');
  await page.getByRole('button', { name: 'Partial Set', exact: true }).click();
  await page.getByLabel('1052', { exact: true }).uncheck();
  await page.getByLabel('Number of identical sets / items').fill('3');
  await page.getByRole('button', { name: 'Save & Add Another', exact: true }).click();
  await page.waitForFunction(() => window.acePrints.length === 2);
  assert.equal(await page.evaluate(() => window.acePrints[1].label_quantity), 3);
  assert.equal(await page.evaluate(() => window.acePrints[1].ace_details.numbers.length), 11);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('ACE browser checks passed: grade dropdown, camera capture, SKU, one sticker per set, partial quantities, next listing reset and mobile width.');
} finally {
  await browser?.close();
  server.kill();
  await unlink(fixturePath);
}
