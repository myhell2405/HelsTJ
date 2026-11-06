'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { createServer } = require('../server');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function close(server) {
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('dashboard counts tracked jobs only from checked statuses', async () => {
  const dashboardScript = await fs.readFile(
    path.join(__dirname, '..', 'public', 'dashboard.js'),
    'utf8',
  );
  const jobs = [
    { status: 'applied' },
    { status: 'in_process' },
    { status: 'rejected' },
    { status: 'closed' },
    { status: 'to_apply' },
    { status: 'verify' },
    { status: 'watchlist' },
  ];
  let dashboardMarkup = '';
  vm.runInNewContext(dashboardScript, {
    jobs,
    window: {},
    document: {
      getElementById(id) {
        assert.equal(id, 'stats');
        return {
          set innerHTML(markup) {
            dashboardMarkup = markup;
          },
        };
      },
    },
  });

  assert.match(dashboardMarkup, /BELUM DI-TRACK<\/span>\s*<strong class="overview-value">3<\/strong>/);
  assert.match(dashboardMarkup, /TOTAL LOWONGAN<\/span>\s*<strong class="overview-value">7<\/strong>/);
  assert.match(dashboardMarkup, /<span class="tracked-total">4 <small>lowongan<\/small><\/span>/);
  assert.match(dashboardMarkup, /Sudah dilamar<\/span>\s*<strong>1<\/strong>/);
  assert.match(dashboardMarkup, /Sedang diproses<\/span>\s*<strong>1<\/strong>/);
  assert.match(dashboardMarkup, /Ditolak \/ tidak lolos<\/span>\s*<strong>1<\/strong>/);
  assert.match(dashboardMarkup, /Tutup \/ batal<\/span>\s*<strong>1<\/strong>/);
  assert.match(dashboardMarkup, /25\.0% dari lowongan yang di-track/);
});

test('job API requires authentication and persists valid data across restarts', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'job-tracker-'));
  const dataFile = path.join(directory, 'jobs.json');
  let server = createServer({
    dataFile,
    username: 'hlmykrm',
    password: 'test-password',
    googleClientId: 'tracker.apps.googleusercontent.com',
  });
  t.after(async () => {
    await close(server);
    await fs.rm(directory, { recursive: true, force: true });
  });

  let baseUrl = await listen(server);
  await server.ready;

  const redirect = await fetch(baseUrl, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/login');
  const loginPage = await fetch(`${baseUrl}/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /loginForm/);

  const page = await fetch(baseUrl, { redirect: 'manual' });
  assert.equal(page.status, 302);
  const unauthorizedExport = await fetch(`${baseUrl}/api/export/xlsx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: [] }),
  });
  assert.equal(unauthorizedExport.status, 401);

  const invalidLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hlmykrm', password: 'wrong-password' }),
  });
  assert.equal(invalidLogin.status, 401);

  let authCookie = await login(baseUrl, 'hlmykrm', 'test-password');
  const auth = { Cookie: authCookie };
  assert.match(authCookie, /^job_tracker_session=/);
  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hlmykrm', password: 'test-password' }),
  });
  assert.match(loginResponse.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\//);

  const authenticatedPage = await fetch(baseUrl, { headers: auth });
  const authenticatedHtml = await authenticatedPage.text();
  assert.equal(authenticatedPage.status, 200);
  assert.match(authenticatedHtml, /storageStatus/);
  assert.match(authenticatedHtml, /myhell2405/);
  assert.match(authenticatedHtml, /id="googleSheetsPanel" hidden/);
  assert.match(authenticatedHtml, /Ditambahkan oleh/);
  assert.match(authenticatedHtml, /canManageJobs=Boolean\(config\.currentUser&&config\.currentUser\.role==='admin'\)/);
  assert.match(authenticatedHtml, /className:'stat-progress'/);
  assert.match(authenticatedHtml, /stat-track/);
  assert.match(authenticatedHtml, /Lowongan sudah di-track/);
  assert.match(authenticatedHtml, /Distribusi status/);
  assert.match(authenticatedHtml, /conic-gradient/);
  assert.match(authenticatedHtml, /HelsTJ <span>Job Tracker<\/span>/);
  assert.doesNotMatch(authenticatedHtml, /\.xls(?!x)(?:<\/strong>|[, )])|\.XLS<\/span>/);
  assert.match(authenticatedHtml, /value\.length===10\?\{dateStyle:'medium',timeZone:'UTC'\}/);
  assert.match(authenticatedHtml, /\$\{\['applied','in_process','rejected','closed'\]\.includes\(j\.status\)\?'checked':''\}/);

  const unauthorized = await fetch(`${baseUrl}/api/jobs`);
  assert.equal(unauthorized.status, 401);

  const config = await fetch(`${baseUrl}/api/config`, { headers: auth });
  assert.deepEqual(await config.json(), {
    googleClientId: 'tracker.apps.googleusercontent.com',
    currentUser: { username: 'hlmykrm', role: 'admin' },
  });

  const firstLoad = await fetch(`${baseUrl}/api/jobs`, { headers: auth });
  assert.deepEqual(await firstLoad.json(), { jobs: [], initialized: false });

  const emptyActivity = await fetch(`${baseUrl}/api/activity`, { headers: auth });
  assert.deepEqual(await emptyActivity.json(), { activities: [] });

  const saved = await fetch(`${baseUrl}/api/jobs`, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: [{
        id: 1,
        company: 'Contoh',
        role: 'Analis',
        category: 'Data',
        sector: 'Keuangan',
        employerType: 'private',
        status: 'applied',
        deadline: '',
        source: '',
        sourceUrl: 'https://example.com/job',
        applicationUrl: 'https://example.com/apply',
        note: '',
        createdAt: '2026-10-27T07:15:00.000Z',
        createdBy: 'Imposter',
        appliedDate: '2026-10-27',
        updated: '2026-10-27',
      }],
    }),
  });
  assert.equal(saved.status, 200);

  const savedJobs = await fetch(`${baseUrl}/api/jobs`, { headers: auth });
  const persistedJob = (await savedJobs.json()).jobs[0];
  assert.equal(persistedJob.sector, 'Keuangan');
  assert.equal(persistedJob.employerType, 'private');
  assert.equal(persistedJob.sourceUrl, 'https://example.com/job');
  assert.equal(persistedJob.applicationUrl, 'https://example.com/apply');
  assert.equal(persistedJob.createdAt, '2026-10-27T07:15:00.000Z');
  assert.equal(persistedJob.createdBy, 'hlmykrm');
  const addedActivityResponse = await fetch(`${baseUrl}/api/activity`, { headers: auth });
  const addedActivities = (await addedActivityResponse.json()).activities;
  assert.equal(addedActivities.length, 1);
  assert.equal(addedActivities[0].action, 'job_added');
  assert.match(addedActivities[0].summary, /Contoh — Analis/);
  assert.equal(addedActivities[0].actor_username, 'hlmykrm');

  const edited = await fetch(`${baseUrl}/api/jobs`, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: [{ ...persistedJob, createdBy: 'Pengguna lain' }] }),
  });
  assert.equal(edited.status, 200);
  const editedJobs = await fetch(`${baseUrl}/api/jobs`, { headers: auth });
  assert.equal((await editedJobs.json()).jobs[0].createdBy, 'hlmykrm');

  const xlsxResponse = await fetch(`${baseUrl}/api/export/xlsx`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: [persistedJob] }),
  });
  assert.equal(xlsxResponse.status, 200);
  assert.match(
    xlsxResponse.headers.get('content-type'),
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
  );
  assert.match(xlsxResponse.headers.get('content-disposition'), /helmy-job-tracker\.xlsx/);
  const excelBytes = await xlsxResponse.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(excelBytes));
  assert.equal(workbook.getWorksheet('Job Tracker').getCell('E2').value, '2026-10-27T07:15:00.000Z');
  assert.equal(workbook.getWorksheet('Job Tracker').getCell('F2').value, 'hlmykrm');
  assert.equal(workbook.getWorksheet('Job Tracker').getCell('M2').value, 'https://example.com/job');

  const parsedFromExcel = await fetch(`${baseUrl}/api/import/parse`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/octet-stream', 'X-File-Name': 'helmy-job-tracker.xlsx' },
    body: excelBytes,
  });
  assert.equal(parsedFromExcel.status, 200);
  const excelParseResult = await parsedFromExcel.json();
  assert.equal(excelParseResult.ok, true);
  assert.equal(excelParseResult.jobs.length, 1);
  assert.equal(excelParseResult.jobs[0].company, 'Contoh');
  assert.equal(excelParseResult.jobs[0].role, 'Analis');
  assert.equal(excelParseResult.jobs[0].status, 'applied');

  const csvPayload = 'Perusahaan,Posisi,Status,Catatan\nBank Mandiri,Data Engineer,Akan dilamar,Prioritas\n,,,\n';
  const parsedFromCsv = await fetch(`${baseUrl}/api/import/parse`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: csvPayload }),
  });
  assert.equal(parsedFromCsv.status, 200);
  const csvParseResult = await parsedFromCsv.json();
  assert.equal(csvParseResult.jobs.length, 1);
  assert.equal(csvParseResult.jobs[0].company, 'Bank Mandiri');
  assert.equal(csvParseResult.jobs[0].role, 'Data Engineer');
  assert.equal(csvParseResult.jobs[0].status, 'to_apply');
  assert.equal(csvParseResult.jobs[0].note, 'Prioritas');

  const largeCsv = `Perusahaan,Posisi,Catatan\nBank Mandiri,Analis Data,"${'""'.repeat(600_000)}"\n`;
  const largeCsvResponse = await fetch(`${baseUrl}/api/import/parse`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: largeCsv }),
  });
  assert.equal(largeCsvResponse.status, 200);
  assert.equal((await largeCsvResponse.json()).jobs[0].note.length, 600_000);

  const rawCsv = await fetch(`${baseUrl}/api/import/parse`, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'text/csv',
      'X-File-Name': 'lowongan.csv',
    },
    body: 'Perusahaan,Posisi\nContoh Raw,Analis Data\n',
  });
  assert.equal(rawCsv.status, 200);
  assert.equal((await rawCsv.json()).jobs[0].company, 'Contoh Raw');

  const unsupportedXls = await fetch(`${baseUrl}/api/import/parse`, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/octet-stream',
      'X-File-Name': 'lowongan.xls',
    },
    body: 'legacy excel data',
  });
  assert.equal(unsupportedXls.status, 415);

  const oversizedImport = await fetch(`${baseUrl}/api/import/parse`, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/octet-stream',
      'X-File-Name': 'lowongan.csv',
    },
    body: Buffer.alloc(2 * 1024 * 1024 + 1, 0x61),
  });
  assert.equal(oversizedImport.status, 413);

  const invalid = await fetch(`${baseUrl}/api/jobs`, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: [{ id: 1, company: 'Contoh', role: 'Analis', status: 'unknown' }] }),
  });
  assert.equal(invalid.status, 400);

  const invalidEmployerType = await fetch(`${baseUrl}/api/jobs`, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: [{ id: 1, company: 'Contoh', role: 'Analis', status: 'applied', employerType: 'unknown' }],
    }),
  });
  assert.equal(invalidEmployerType.status, 400);

  await close(server);
  server = createServer({ dataFile, username: 'friend', role: 'user', password: 'test-password' });
  baseUrl = await listen(server);
  await server.ready;
  authCookie = await login(baseUrl, 'friend', 'test-password');
  const friendAuth = { Cookie: authCookie };
  const loaded = await fetch(`${baseUrl}/api/jobs`, { headers: friendAuth });
  const savedData = await loaded.json();
  assert.deepEqual(savedData.jobs.map((job) => job.company), ['Contoh']);
  assert.equal(savedData.initialized, true);
  const hiddenActivity = await fetch(`${baseUrl}/api/activity`, { headers: friendAuth });
  assert.equal(hiddenActivity.status, 403);
  const deniedActivityDelete = await fetch(`${baseUrl}/api/activity/1`, {
    method: 'DELETE',
    headers: friendAuth,
  });
  assert.equal(deniedActivityDelete.status, 403);
  const deniedActivityClear = await fetch(`${baseUrl}/api/activity`, {
    method: 'DELETE',
    headers: friendAuth,
  });
  assert.equal(deniedActivityClear.status, 403);

  const deniedDelete = await fetch(`${baseUrl}/api/jobs`, {
    method: 'PUT',
    headers: { ...friendAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: [] }),
  });
  assert.equal(deniedDelete.status, 403);
  const afterDeniedDelete = await fetch(`${baseUrl}/api/jobs`, { headers: friendAuth });
  assert.equal((await afterDeniedDelete.json()).jobs.length, 1);

  const deniedStatusChange = await fetch(`${baseUrl}/api/jobs`, {
    method: 'PUT',
    headers: { ...friendAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: [{ ...savedData.jobs[0], status: 'rejected' }] }),
  });
  assert.equal(deniedStatusChange.status, 403);

  const deniedDetailsEdit = await fetch(`${baseUrl}/api/jobs`, {
    method: 'PUT',
    headers: { ...friendAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: [{ ...savedData.jobs[0], note: 'Edit oleh teman' }] }),
  });
  assert.equal(deniedDetailsEdit.status, 403);

  const friendAddition = await fetch(`${baseUrl}/api/jobs`, {
    method: 'PUT',
    headers: { ...friendAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: [...savedData.jobs, {
        ...savedData.jobs[0],
        id: 2,
        company: 'Lowongan baru',
        status: 'to_apply',
      }],
    }),
  });
  assert.equal(friendAddition.status, 200);
  const afterFriendAddition = await fetch(`${baseUrl}/api/jobs`, { headers: friendAuth });
  const friendJobs = (await afterFriendAddition.json()).jobs;
  assert.equal(friendJobs.length, 2);
  assert.equal(friendJobs[1].createdBy, 'friend');
  const friendActivity = await fetch(`${baseUrl}/api/activity`, { headers: friendAuth });
  assert.equal(friendActivity.status, 403);

  const deniedNewStatus = await fetch(`${baseUrl}/api/jobs`, {
    method: 'PUT',
    headers: { ...friendAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: [...friendJobs.slice(0, 1), { ...friendJobs[1], status: 'applied' }],
    }),
  });
  assert.equal(deniedNewStatus.status, 403);

  await close(server);
  server = createServer({ dataFile, username: 'hlmykrm', role: 'admin', password: 'test-password' });
  baseUrl = await listen(server);
  await server.ready;
  authCookie = await login(baseUrl, 'hlmykrm', 'test-password');
  const adminAuth = { Cookie: authCookie };
  const cleared = await fetch(`${baseUrl}/api/jobs`, {
    method: 'PUT',
    headers: { ...adminAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: [] }),
  });
  assert.equal(cleared.status, 200);
  const deletionActivity = await fetch(`${baseUrl}/api/activity`, { headers: adminAuth });
  const deletedEvents = (await deletionActivity.json()).activities;
  assert.equal(deletedEvents.length, 2);
  assert.ok(deletedEvents.every((activity) => activity.action === 'job_deleted'));
  const removedActivity = await fetch(`${baseUrl}/api/activity/${deletedEvents[0].id}`, {
    method: 'DELETE',
    headers: adminAuth,
  });
  assert.equal(removedActivity.status, 200);
  assert.deepEqual(await removedActivity.json(), { ok: true });
  const remainingActivity = await fetch(`${baseUrl}/api/activity`, { headers: adminAuth });
  assert.equal((await remainingActivity.json()).activities.length, 1);
  const missingActivity = await fetch(`${baseUrl}/api/activity/999999`, {
    method: 'DELETE',
    headers: adminAuth,
  });
  assert.equal(missingActivity.status, 404);
  const clearedActivity = await fetch(`${baseUrl}/api/activity`, {
    method: 'DELETE',
    headers: adminAuth,
  });
  assert.equal(clearedActivity.status, 200);
  assert.deepEqual(await clearedActivity.json(), { ok: true });
  const emptyActivityAfterClear = await fetch(`${baseUrl}/api/activity`, { headers: adminAuth });
  assert.deepEqual((await emptyActivityAfterClear.json()).activities, []);
  const logout = await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: adminAuth,
  });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${baseUrl}/api/jobs`, { headers: adminAuth });
  assert.equal(afterLogout.status, 401);
});

test('inline browser script is valid JavaScript', async () => {
  const html = await fs.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const script = scripts[0];
  assert.ok(script, 'The app script should exist.');
  assert.ok(scripts.length > 0, 'The app script should exist.');
  scripts.forEach((source) => assert.doesNotThrow(() => new vm.Script(source)));
  assert.match(html, /data-activity-id=/);
  assert.match(html, /method:'DELETE'/);
  assert.match(html, /<nav id="adminNav" class="admin-nav" aria-label="Navigasi admin" hidden>/);
  assert.match(html, /data-admin-page="dashboardSection">Dashboard<\/a><a href="#adminPanel" data-admin-page="adminPanel">Pengguna<\/a><a href="#activityPanel" data-admin-page="activityPanel">Aktivitas<\/a><a href="#jobsSection" data-admin-page="jobsSection">Lowongan<\/a>/);
  assert.match(html, /id="dashboardSection" class="dashboard-section"><section class="stats" id="stats"><\/section><\/section>/);
  assert.match(script, /function showAdminPage\(page\)/);
  assert.match(script, /pages\.forEach\(id=>\{document\.getElementById\(id\)\.hidden=id!==page\}\)/);
  assert.match(script, /showAdminPage\('dashboardSection'\)/);
  assert.match(html, /classList\.toggle\('compact',!canManageJobs\)/);
  assert.match(html, /adminNav'\)\.hidden=false/);
  assert.match(html, /\.stats\.compact \.stat-track,\.stats\.compact \.stat-foot\{display:none\}/);
  assert.match(html, /id="creatorFilter"/);
  assert.match(html, /id="importJobsBtn"/);
  assert.match(html, /id="importModal"/);
  assert.match(script, /const matchCreator=u==='all'\|\|/);
  assert.match(script, /function initCreators\(\)/);
  assert.match(script, /window\.filterByCreator=function\(user\)/);
  assert.doesNotMatch(html, /Impor cadangan/);
  assert.doesNotMatch(html, /id="importBtn"/);

  const loginHtml = await fs.readFile(path.join(__dirname, '..', 'public', 'login.html'), 'utf8');
  const loginScript = loginHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(loginScript, 'The login page script should exist.');
  assert.doesNotThrow(() => new vm.Script(loginScript));
  assert.match(loginHtml, /class="mark" aria-hidden="true">HelsTJ<\/div>/);
  assert.match(loginHtml, /Masuk ke HelsTJ/);
  assert.match(loginHtml, /id="passwordToggle"/);
  assert.match(loginScript, /Sembunyikan kata sandi/);
});
