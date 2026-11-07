// Operator-only local visual review. Uses the ordinary private credential flow;
// creates one synthetic assessment in the isolated HOST001/DEMO001 store.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
process.loadEnvFile('.env.local');
const origin = 'http://127.0.0.1:3000';
if (process.env.STORAGE_ADAPTER !== 'local' || process.env.LOCAL_TEST_ACCOUNTS !== 'true' || process.env.NODE_ENV === 'production' || process.env.APP_URL !== origin)
  throw new Error('Visual review requires the existing loopback local test environment');
const folder = resolve('docs/screenshots/final');
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
async function login(id, key) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: origin });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email or User ID').fill(id);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill(process.env[key]);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(id === 'HOST001' ? '/host' : '/attendee');
  return { context, page };
}
const screens = [];
async function shot(page, file, title, path) {
  await page.goto(path);
  await expect(page.locator('.corporate-content h1')).toBeVisible();
  await expect(page.locator('.loading')).toHaveCount(0);
  await page.screenshot({ path: resolve(folder, file + '.png'), fullPage: true });
  screens.push({ file, title, path });
}
try {
  const h = await login('HOST001', 'TEST_HOST_PASSWORD');
  const created = await h.page.request.post('/api/programs', {
    headers: { Origin: origin },
    data: { company: 'TechnoEdge Learning Services', cohort: 'Internal visual review — 7 November 2026', requestId: randomUUID() },
  });
  expect(created.status()).toBe(201);
  const { program } = await created.json();
  await shot(h.page, 'host-dashboard', 'Host dashboard', '/host');
  await shot(h.page, 'host-create', 'Create assessment', '/host/assessments/new');
  await shot(h.page, 'host-manage', 'Paired room management', '/host/assessments/' + program.id);
  const rooms = (await (await h.page.request.get('/api/rooms')).json()).rooms;
  let evaluation;
  for (const room of rooms) {
    const response = await h.page.request.get(`/api/rooms/${room.id}/participants`);
    const data = await response.json();
    const person = data.participants?.find(p => p.submittedAt && p.selected.length === 3);
    if (person) { evaluation = { room, person }; break; }
  }
  if (evaluation) {
    await shot(h.page, 'host-monitor', 'Live monitoring and participants', `/host/rooms/${evaluation.room.id}/monitor`);
    await shot(h.page, 'host-evaluate', 'Practical evaluation', `/host/rooms/${evaluation.room.id}/evaluate/${evaluation.person.identity.id}`);
  }
  await shot(h.page, 'host-analytics', 'Observed outcomes and modeled ROI', '/host/reports');
  await shot(h.page, 'host-export', 'Excel and evidence exports', '/host/reports/export');
  const a = await login('DEMO001', 'TEST_ATTENDEE_PASSWORD');
  const entries = (await (await a.page.request.get('/api/dashboard')).json()).entries;
  const pair = entries.find(e => e.room.programId && e.room.phase === 'post' && e.participant?.submittedAt);
  await shot(a.page, 'attendee-dashboard', 'Personal dashboard', '/attendee');
  await shot(a.page, 'attendee-assessments', 'Base Camp and Summit availability', '/attendee/assessments');
  await shot(a.page, 'attendee-join', 'Room entry and confirmed join', '/attendee/join');
  if (pair) await shot(a.page, 'attendee-comparison', 'Pre/Post comparison', `/attendee/results/${pair.room.programId}/comparison`);
  expect((await a.page.request.post(`/api/rooms/${program.preRoomId}/join`, { headers: { Origin: origin }, data: {} })).status()).toBe(200);
  expect((await a.page.request.post(`/api/rooms/${program.preRoomId}/start`, { headers: { Origin: origin }, data: { selected: ['tables', 'dashboard', 'mbr'] } })).status()).toBe(200);
  await shot(a.page, 'attendee-workspace', 'Timed assessment and evidence workspace', `/attendee/rooms/${program.preRoomId}`);
  await a.page.setViewportSize({ width: 390, height: 844 });
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.page.screenshot({ path: resolve(folder, 'attendee-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
  await writeFile(resolve(folder, 'index.json'), JSON.stringify({ captured: '2026-11-07', dataClassification: 'synthetic-test', screens }, null, 2));
  console.log(`Captured ${screens.length} desktop views and a 390px mobile workspace; no page errors. Only isolated synthetic local records were created.`);
} finally {
  await browser.close();
}
