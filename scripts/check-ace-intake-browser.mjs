import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.ACE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ACE_PLAYWRIGHT_MODULE).href : 'playwright');

const fixturePath = new URL('../ace-intake-smoke.html', import.meta.url);
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main class="app"><div id="root"></div></main><script type="module">' +
  'import React from "react"; import {createRoot} from "react-dom/client";' +
  'import AcePaceIntake from "/src/AcePaceIntake.jsx"; import "/src/App.css";' +
  'createRoot(document.getElementById("root")).render(React.createElement(AcePaceIntake,{' +
  'onClose:()=>{},onSaved:async()=>{if(window.aceNeverRefresh)await new Promise(()=>{});},syncSquare:async()=>{if(window.aceFailSync){window.aceFailSync=false;throw new Error("Simulated Square failure");}},generateSku:async()=>"ILHRC-999999",' +
  'uploadPhoto:async file=>{window.aceUploaded={type:file.type,size:file.size};return "https://ace-test.supabase.co/storage/v1/object/public/book-covers/test.jpg";},' +
  '}));</script></body></html>';
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
  const downloads = [];
  page.on('download', download => downloads.push(download));
  const queuedLabels = new Map();
  let savedPayload;
  let receiptCalls = 0;
  let duplicateListing = null;
  await page.route('https://ace-test.supabase.co/**', async route => {
    const url = route.request().url();
    let body;
    if (url.includes('/ace_pricing')) body = { prices: { complete: 8, older: 5, individual: .75, partial: .5, scoreKey: 1, test: .25 } };
    else if (url.includes('/rpc/receive_ace_intake')) {
      const request = route.request().postDataJSON();
      receiptCalls += 1;
      savedPayload = request.p_item;
      const sku = request.p_item.sku || (request.p_existing_id ? duplicateListing?.sku : 'ILHRC-999999');
      const pending = (queuedLabels.get(sku) || 0) + request.p_quantity;
      queuedLabels.set(sku, pending);
      body = { ...request.p_item, id: 100, sku, quantity: request.p_quantity, received_quantity: request.p_quantity, label_printed: false, pending_label_quantity: pending };
    } else if (url.includes('/storage/')) {
      await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcGoAAAAASUVORK5CYII=', 'base64') });
      return;
    } else if (url.includes('/rest/v1/items')) {
      try {
        const filter = new URL(url).searchParams.get('ace_details');
        if (!filter?.startsWith('eq.')) throw new Error('Missing exact duplicate filter');
        JSON.parse(filter.slice(3));
      } catch {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '22P02', message: 'invalid input syntax for type json' }) });
        return;
      }
      body = duplicateListing ? [duplicateListing] : [];
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

  await page.getByRole('combobox', { name: 'Subject', exact: true }).selectOption('Word Building');
  assert.equal(await page.getByRole('combobox', { name: 'Condition', exact: true }).count(), 0);
  await page.getByRole('textbox', { name: 'Listing SKU' }).fill('unfinished SKU');
  assert.equal(await page.getByText('$8.00', { exact: true }).isVisible(), true);
  await page.getByRole('textbox', { name: 'Listing SKU' }).fill('');
  await page.getByRole('button', { name: 'Take Photo', exact: true }).click();
  await page.getByRole('button', { name: 'Use This Photo' }).click();
  await page.getByAltText('ACE listing photo preview').waitFor();
  await page.getByRole('textbox', { name: 'Listing SKU' }).fill('ace-math-5');
  assert.equal(await page.getByRole('button', { name: 'Save & Print Sticker', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Save & Add Another', exact: true }).click();
  await page.getByText('Confirm that all expected student PACEs are present before saving.').waitFor();
  assert.equal(receiptCalls, 0);
  await page.getByLabel('All 12 student PACEs are present').check();
  await page.evaluate(() => { window.aceFailSync = true; window.aceNeverRefresh = true; });
  await page.getByRole('button', { name: 'Save & Add Another', exact: true }).click();
  await page.getByRole('button', { name: 'Retry Square Sync' }).waitFor();
  assert.equal(savedPayload.sku, 'ACE-MATH-5');
  assert.equal(savedPayload.image_url, 'https://ace-test.supabase.co/storage/v1/object/public/book-covers/test.jpg');
  assert.equal(savedPayload.ace_details.numbers.length, 12);
  assert.ok((await page.evaluate(() => window.aceUploaded)).size > 0);
  assert.equal(queuedLabels.get('ACE-MATH-5'), 1);
  assert.equal(downloads.length, 0);
  assert.equal(await page.getByRole('button', { name: /^Print Sticker/ }).count(), 0);
  assert.equal(receiptCalls, 1);
  await page.getByRole('button', { name: 'Retry Square Sync' }).click();
  await page.getByRole('button', { name: 'Save & Add Another', exact: true }).waitFor();
  assert.equal(receiptCalls, 1, 'Square retry must not receive stock again');
  assert.equal(queuedLabels.get('ACE-MATH-5'), 1, 'Square retry must not queue a second sticker');
  assert.equal(await page.getByRole('textbox', { name: 'Listing SKU' }).inputValue(), '');
  assert.equal(await page.getByAltText('ACE listing photo preview').count(), 0);
  await page.getByRole('button', { name: 'Generate SKU', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Listing SKU' }).inputValue(), 'ILHRC-999999');
  await page.getByRole('button', { name: 'Partial Set', exact: true }).click();
  await page.getByLabel('1052', { exact: true }).uncheck();
  await page.getByLabel('Number of identical sets / items').fill('3');
  await page.getByRole('button', { name: 'Save & Add Another', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#ace-sku')?.value === '');
  assert.equal(queuedLabels.get('ILHRC-999999'), 3);
  assert.equal(savedPayload.ace_details.numbers.length, 11);
  await page.waitForFunction(() => document.querySelector('#ace-sku')?.value === '');
  assert.equal(await page.getByRole('combobox', { name: 'Subject', exact: true }).inputValue(), 'Word Building');
  assert.equal(await page.getByRole('combobox', { name: 'Writing present', exact: true }).inputValue(), 'No writing');
  await page.getByRole('button', { name: 'Complete Set', exact: true }).click();
  await page.getByLabel('All 12 student PACEs are present').check();
  await page.getByRole('textbox', { name: 'Listing SKU' }).fill('KEYBOARD-SAVE');
  await page.getByRole('textbox', { name: 'Listing SKU' }).press('Enter');
  await page.waitForFunction(() => document.querySelector('#ace-sku')?.value === '');
  assert.equal(receiptCalls, 3);
  assert.equal(queuedLabels.get('KEYBOARD-SAVE'), 1);
  assert.equal(savedPayload.condition, 'Not assessed');
  assert.equal(savedPayload.notes.includes('Condition:'), false);
  duplicateListing = { ...savedPayload, id: 100, sku: 'EXISTING-WORD-BUILDING', quantity: 4 };
  await page.getByLabel('All 12 student PACEs are present').check();
  await page.getByRole('button', { name: 'Save & Add Another', exact: true }).click();
  await page.getByRole('heading', { name: 'Matching listing found', exact: true }).waitFor();
  assert.equal(receiptCalls, 3);
  await page.getByRole('button', { name: 'Increase Existing Quantity', exact: true }).click();
  await page.getByRole('heading', { name: 'Matching listing found', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Save & Add Another', exact: true }).waitFor();
  assert.equal(receiptCalls, 4);
  assert.equal(queuedLabels.get('EXISTING-WORD-BUILDING'), 1);
  await page.waitForFunction(() => document.querySelector('#ace-sku')?.value === '');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  assert.equal(downloads.length, 0, 'Intake never downloads per-listing sticker files');
  assert.equal([...queuedLabels.values()].reduce((total, value) => total + value, 0), 6);
  assert.equal(await page.getByRole('button', { name: /^Print Sticker/ }).count(), 0);
  console.log('ACE browser checks passed: real JSON duplicate filters and increase-existing flow, visible incomplete-set errors, bulk Print Queue labels with zero per-listing downloads, one save action, next listing reset, keyboard save, no condition control and mobile width.');
} finally {
  await browser?.close();
  server.kill();
  await unlink(fixturePath);
}
