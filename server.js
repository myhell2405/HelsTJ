'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const ExcelJS = require('exceljs');

const statuses = new Set([
  'applied',
  'in_process',
  'rejected',
  'to_apply',
  'verify',
  'watchlist',
  'closed',
]);
const maxRequestBytes = 2 * 1024 * 1024;
const maxImportJsonBytes = 5 * 1024 * 1024;
const htmlPath = path.join(__dirname, 'public', 'index.html');
const loginPath = path.join(__dirname, 'public', 'login.html');
const dashboardScriptPath = path.join(__dirname, 'public', 'dashboard.js');
const dashboardStylePath = path.join(__dirname, 'public', 'dashboard.css');
const sessionCookie = 'job_tracker_session';
const sessionDurationMs = 12 * 60 * 60 * 1000;
const loginWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 10;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function constantTimeEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(left).digest();
  const rightHash = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function validateJobs(value) {
  if (!Array.isArray(value) || value.length > 2000) {
    throw new HttpError(400, 'Data lamaran harus berupa daftar maksimal 2.000 entri.');
  }

  const ids = new Set();
  return value.map((job) => {
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      throw new HttpError(400, 'Format salah: setiap lamaran harus berupa objek.');
    }

    if (!Number.isSafeInteger(job.id) || job.id < 1 || ids.has(job.id)) {
      throw new HttpError(400, 'Setiap lamaran harus memiliki ID unik yang valid.');
    }
    ids.add(job.id);

    const text = (field, maxLength, required = false) => {
      const fieldValue = job[field] ?? '';
      if (typeof fieldValue !== 'string' || fieldValue.length > maxLength) {
        throw new HttpError(400, `Nilai ${field} tidak valid.`);
      }
      if (required && !fieldValue.trim()) {
        throw new HttpError(400, `${field} wajib diisi.`);
      }
      return fieldValue;
    };

    const status = text('status', 30, true);
    if (!statuses.has(status)) {
      throw new HttpError(400, 'Status lamaran tidak dikenal.');
    }

    const employerType = text('employerType', 20);
    if (!['', 'government', 'private'].includes(employerType)) {
      throw new HttpError(400, 'Jenis pemberi kerja harus pemerintah atau swasta.');
    }

    return {
      id: job.id,
      company: text('company', 200, true),
      role: text('role', 300, true),
      category: text('category', 100) || 'Lainnya',
      sector: text('sector', 150),
      employerType,
      status,
      deadline: text('deadline', 200),
      source: text('source', 1000),
      sourceUrl: text('sourceUrl', 2000),
      applicationUrl: text('applicationUrl', 2000),
      note: text('note', 5000),
      createdAt: text('createdAt', 40),
      createdBy: text('createdBy', 32),
      appliedDate: text('appliedDate', 40),
      updated: text('updated', 40),
    };
  });
}

async function readStore(dataFile) {
  try {
    const parsed = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    return validateJobs(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function updateImportFormatCopy(html) {
  return html
    .replaceAll('accept=".xlsx,.xls,.csv,', 'accept=".xlsx,.csv,')
    .replaceAll('application/vnd.ms-excel,', '')
    .replaceAll('Excel (.xlsx, .xls)', 'Excel (.xlsx)')
    .replaceAll('<strong>.xlsx</strong>, <strong>.xls</strong>, dan', '<strong>.xlsx</strong> dan')
    .replaceAll('<span class="format-tag">.XLS</span>', '')
    .replaceAll("['.xlsx','.xls','.csv']", "['.xlsx','.csv']")
    .replaceAll('.xlsx, .xls, atau .csv', '.xlsx atau .csv');
}

function readJsonBody(request, maxBytes = maxRequestBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        tooLarge = true;
        body = '';
      }
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(new HttpError(413, 'Ukuran data terlalu besar.'));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, 'Isi permintaan bukan JSON yang valid.'));
      }
    });
    request.on('error', reject);
  });
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > maxRequestBytes) {
        reject(new HttpError(413, 'Ukuran file terlalu besar (maksimal 2MB).'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

const FIELD_SYNONYMS = {
  company: ['company', 'perusahaan', 'namaperusahaan', 'companyname', 'instansi', 'organisasi', 'namaorganisasi'],
  role: ['role', 'posisi', 'jabatan', 'jobtitle', 'title', 'pekerjaan', 'posisijob', 'lowongan', 'posisipekerjaan'],
  category: ['category', 'kategori', 'bidang', 'divisi', 'departemen'],
  sector: ['sector', 'sektor', 'sektorpekerjaan', 'industri', 'industry'],
  employerType: ['employertype', 'pemerintahswasta', 'tipeperusahaan', 'jenispemberikerja', 'instansi'],
  status: ['status', 'statuslamaran', 'state'],
  deadline: ['deadline', 'tenggat', 'bataswaktu', 'duedate'],
  source: ['source', 'sumber', 'namasumber', 'platform', 'infodari'],
  sourceUrl: ['sourceurl', 'urlsumber', 'linksumber', 'websumber'],
  applicationUrl: ['applicationurl', 'urllamaran', 'linklamaran', 'linklamar', 'formlamaran', 'link'],
  note: ['note', 'notes', 'catatan', 'keterangan', 'deskripsi', 'description'],
  appliedDate: ['applieddate', 'tanggallamaran', 'tanggallamar', 'appliedat', 'tglkirim'],
  createdAt: ['createdat', 'waktuditambahkan', 'tanggaldibuat', 'createdtime'],
  createdBy: ['createdby', 'ditambahkanoleh', 'pembuat', 'penambah', 'creator'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeStatus(val) {
  const v = String(val || '').trim().toLowerCase();
  if (['to_apply', 'akan dilamar', 'belum dilamar', 'rencana', 'to apply'].some((x) => v.includes(x))) return 'to_apply';
  if (['in_process', 'sedang diproses', 'in process', 'proses', 'interview', 'tahap seleksi', 'test', 'tes', 'screening'].some((x) => v.includes(x))) return 'in_process';
  if (['rejected', 'ditolak', 'tidak lolos', 'gagal', 'not selected'].some((x) => v.includes(x))) return 'rejected';
  if (['verify', 'perlu verifikasi', 'verifikasi'].some((x) => v.includes(x))) return 'verify';
  if (['watchlist', 'pantauan', 'bookmark', 'simpan'].some((x) => v.includes(x))) return 'watchlist';
  if (['closed', 'tutup', 'batal', 'expired', 'kadaluarsa'].some((x) => v.includes(x))) return 'closed';
  if (['applied', 'sudah dilamar', 'dilamar', 'sent', 'terkirim'].some((x) => v.includes(x))) return 'applied';
  return 'to_apply';
}

function normalizeEmployerType(val) {
  const v = String(val || '').trim().toLowerCase();
  if (['government', 'pemerintah', 'bumn', 'negeri', 'gov', 'asn', 'pns'].some((x) => v.includes(x))) return 'government';
  if (['private', 'swasta'].some((x) => v.includes(x))) return 'private';
  return '';
}

function parseCsv(text) {
  const lines = [];
  let row = [''];
  let inQuotes = false;
  const firstLineEnd = text.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const delimiter = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"') {
        if (next === '"') {
          row[row.length - 1] += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        row[row.length - 1] += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === delimiter) {
        row.push('');
      } else if (c === '\r') {
        if (next === '\n') i++;
        lines.push(row);
        row = [''];
      } else if (c === '\n') {
        lines.push(row);
        row = [''];
      } else {
        row[row.length - 1] += c;
      }
    }
  }
  if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
    lines.push(row);
  }
  return lines;
}

function parseMatrixToJobs(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2) {
    return { jobs: [], totalRows: 0, skippedRows: 0 };
  }
  let headerIndex = -1;
  for (let i = 0; i < Math.min(10, matrix.length); i++) {
    if (matrix[i].filter(Boolean).length >= 2) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    return { jobs: [], totalRows: 0, skippedRows: 0 };
  }

  const rawHeaders = matrix[headerIndex].map((h) => normalizeHeader(h));
  const colIndexToField = {};
  rawHeaders.forEach((normH, idx) => {
    for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
      if (synonyms.includes(normH) && !Object.values(colIndexToField).includes(field)) {
        colIndexToField[idx] = field;
        break;
      }
    }
  });

  const jobs = [];
  let skippedRows = 0;
  const totalRows = matrix.length - (headerIndex + 1);

  for (let r = headerIndex + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || row.every((cell) => !cell || !String(cell).trim())) {
      continue;
    }
    const rowObj = {};
    row.forEach((cell, idx) => {
      const field = colIndexToField[idx];
      if (field) rowObj[field] = cell;
    });

    const company = String(rowObj.company || '').trim();
    const role = String(rowObj.role || '').trim();
    if (!company || !role) {
      skippedRows++;
      continue;
    }

    jobs.push({
      company,
      role,
      category: String(rowObj.category || '').trim() || 'Lainnya',
      sector: String(rowObj.sector || '').trim(),
      employerType: normalizeEmployerType(rowObj.employerType),
      status: normalizeStatus(rowObj.status),
      deadline: String(rowObj.deadline || '').trim(),
      source: String(rowObj.source || '').trim(),
      sourceUrl: String(rowObj.sourceUrl || '').trim(),
      applicationUrl: String(rowObj.applicationUrl || '').trim(),
      note: String(rowObj.note || '').trim(),
      appliedDate: String(rowObj.appliedDate || '').trim(),
      createdAt: String(rowObj.createdAt || '').trim(),
      createdBy: String(rowObj.createdBy || '').trim(),
    });
  }

  return { jobs, totalRows, skippedRows };
}

async function parseExcelOrCsvBuffer(buffer, fileName = '') {
  const isCsv = fileName.toLowerCase().endsWith('.csv')
    || (buffer.length > 0 && buffer[0] !== 0x50 && buffer[1] !== 0x4b);
  if (isCsv) {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const matrix = parseCsv(text);
    return parseMatrixToJobs(matrix);
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new HttpError(400, 'File Excel tidak memiliki lembar kerja (worksheet).');
    }
    const matrix = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const rowValues = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        let val = cell.value;
        if (val && typeof val === 'object') {
          if (val.text) val = val.text;
          else if (val.result) val = val.result;
          else if (val instanceof Date) val = val.toISOString().slice(0, 10);
          else val = cell.text || '';
        }
        rowValues[colNumber - 1] = val !== undefined && val !== null ? String(val).trim() : '';
      });
      matrix.push(rowValues);
    });
    return parseMatrixToJobs(matrix);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    try {
      let text = buffer.toString('utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const matrix = parseCsv(text);
      if (matrix.length > 1) {
        return parseMatrixToJobs(matrix);
      }
    } catch {}
    throw new HttpError(400, 'Format file Excel tidak valid atau rusak. Pastikan file berformat .xlsx atau .csv.');
  }
}

function getSessionId(request, sessions) {
  const cookies = request.headers.cookie || '';
  const cookie = cookies.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`));
  if (!cookie) return null;

  const sessionId = cookie.slice(sessionCookie.length + 1);
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return sessionId;
}

function createServer(options = {}) {
  const dataFile = path.resolve(options.dataFile || process.env.DATA_FILE || path.join(__dirname, 'data', 'jobs.json'));
  const username = options.username || process.env.APP_USERNAME || 'helmy';
  const role = options.role || 'admin';
  const password = options.password ?? process.env.APP_PASSWORD ?? '';
  const googleClientId = options.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? '';
  const sessions = new Map();
  const loginAttempts = new Map();
  const activities = [];
  let jobs = [];
  let hasSavedData = false;
  let saveQueue = Promise.resolve();

  function recordActivity(actorUsername, action, summary) {
    activities.unshift({
      id: Date.now() + activities.length,
      actor_username: actorUsername,
      action,
      summary,
      created_at: new Date().toISOString(),
    });
    if (activities.length > 50) activities.length = 50;
  }

  if (!password) {
    throw new Error('APP_PASSWORD wajib diatur sebelum menjalankan aplikasi.');
  }

  const ready = readStore(dataFile).then((savedJobs) => {
    hasSavedData = savedJobs !== null;
    jobs = savedJobs || [];
  });

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Cache-Control', 'no-store');

    try {
      await ready;
      const pathname = new URL(request.url, 'http://localhost').pathname;

      if (request.method === 'GET' && (pathname === '/login' || pathname === '/login.html')) {
        const html = await fs.readFile(loginPath);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
      }

      const sessionId = getSessionId(request, sessions);

      if (pathname === '/api/session' && request.method === 'GET') {
        sendJson(response, 200, { authenticated: Boolean(sessionId) });
        return;
      }

      if (pathname === '/api/login' && request.method === 'POST') {
        const attemptKey = request.socket.remoteAddress || 'unknown';
        const current = loginAttempts.get(attemptKey);
        const attempt = current && current.startedAt + loginWindowMs > Date.now()
          ? current
          : { startedAt: Date.now(), count: 0 };
        if (attempt.count >= maxLoginAttempts) {
          loginAttempts.set(attemptKey, attempt);
          sendJson(response, 429, { error: 'Terlalu banyak percobaan. Coba lagi 15 menit kemudian.' });
          return;
        }

        const credentials = await readJsonBody(request);
        const suppliedUsername = typeof credentials?.username === 'string' ? credentials.username : '';
        const suppliedPassword = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!constantTimeEqual(suppliedUsername, username) || !constantTimeEqual(suppliedPassword, password)) {
          attempt.count += 1;
          loginAttempts.set(attemptKey, attempt);
          sendJson(response, 401, { error: 'Nama pengguna atau kata sandi salah.' });
          return;
        }

        loginAttempts.delete(attemptKey);
        const newSessionId = crypto.randomBytes(32).toString('hex');
        sessions.set(newSessionId, { expiresAt: Date.now() + sessionDurationMs });
        const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        response.writeHead(200, {
          'Set-Cookie': `${sessionCookie}=${newSessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDurationMs / 1000}${secureCookie}`,
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (!sessionId) {
        if (request.method === 'GET' && (pathname === '/' || pathname === '/helmy_job_tracker.html')) {
          response.writeHead(302, { Location: '/login' });
          response.end();
          return;
        }
        sendJson(response, 401, { error: 'Sesi login tidak ada atau sudah berakhir. Silakan masuk kembali.' });
        return;
      }

      if (pathname === '/api/logout' && request.method === 'POST') {
        sessions.delete(sessionId);
        const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        response.writeHead(200, {
          'Set-Cookie': `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`,
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (pathname === '/api/config' && request.method === 'GET') {
        sendJson(response, 200, {
          googleClientId,
          currentUser: { username, role },
        });
        return;
      }

      if (pathname === '/api/jobs' && request.method === 'GET') {
        sendJson(response, 200, { jobs, initialized: hasSavedData });
        return;
      }

      if (pathname === '/api/activity' && request.method === 'GET') {
        if (role !== 'admin') {
          throw new HttpError(403, 'Riwayat aktivitas hanya dapat dilihat admin.');
        }
        sendJson(response, 200, { activities });
        return;
      }

      if (pathname === '/api/activity' && request.method === 'DELETE') {
        if (role !== 'admin') {
          throw new HttpError(403, 'Hanya admin yang dapat menghapus aktivitas.');
        }
        activities.length = 0;
        sendJson(response, 200, { ok: true });
        return;
      }

      const activityMatch = pathname.match(/^\/api\/activity\/(\d+)$/);
      if (request.method === 'DELETE' && activityMatch) {
        if (role !== 'admin') {
          throw new HttpError(403, 'Hanya admin yang dapat menghapus aktivitas.');
        }
        const activityId = Number(activityMatch[1]);
        if (!Number.isSafeInteger(activityId) || activityId < 1) {
          throw new HttpError(400, 'ID aktivitas tidak valid.');
        }
        const activityIndex = activities.findIndex((activity) => activity.id === activityId);
        if (activityIndex === -1) {
          throw new HttpError(404, 'Aktivitas tidak ditemukan.');
        }
        activities.splice(activityIndex, 1);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (pathname === '/api/export/xlsx' && request.method === 'POST') {
        const body = await readJsonBody(request);
        const exportJobs = validateJobs(body?.jobs);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Job Tracker');
        worksheet.columns = [
          { header: 'ID', key: 'id', width: 10 },
          { header: 'Perusahaan', key: 'company', width: 28 },
          { header: 'Posisi', key: 'role', width: 36 },
          { header: 'Kategori', key: 'category', width: 24 },
          { header: 'Waktu Ditambahkan', key: 'createdAt', width: 24 },
          { header: 'Ditambahkan Oleh', key: 'createdBy', width: 22 },
          { header: 'Sektor', key: 'sector', width: 22 },
          { header: 'Pemerintah/Swasta', key: 'employerType', width: 22 },
          { header: 'Status', key: 'status', width: 20 },
          { header: 'Tanggal Lamaran', key: 'appliedDate', width: 18 },
          { header: 'Tenggat', key: 'deadline', width: 24 },
          { header: 'Sumber', key: 'source', width: 24 },
          { header: 'URL Sumber', key: 'sourceUrl', width: 40 },
          { header: 'URL Lamaran', key: 'applicationUrl', width: 40 },
          { header: 'Catatan', key: 'note', width: 48 },
        ];
        worksheet.addRows(exportJobs);
        worksheet.getRow(1).font = { bold: true };
        const file = await workbook.xlsx.writeBuffer();
        response.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="helmy-job-tracker.xlsx"',
          'Cache-Control': 'no-store',
        });
        response.end(Buffer.from(file));
        return;
      }

      if (pathname === '/api/import/parse' && request.method === 'POST') {
        const contentType = request.headers['content-type'] || '';
        let result;
        if (contentType.includes('application/json')) {
          const body = await readJsonBody(request, maxImportJsonBytes);
          if (typeof body?.csv === 'string') {
            const matrix = parseCsv(body.csv);
            result = parseMatrixToJobs(matrix);
          } else if (Array.isArray(body?.rows)) {
            result = parseMatrixToJobs(body.rows);
          } else {
            throw new HttpError(400, 'Data JSON tidak valid untuk parsing lowongan.');
          }
        } else {
          const rawBuffer = await readRawBody(request);
          const fileName = decodeURIComponent(request.headers['x-file-name'] || '');
          if (fileName.toLowerCase().endsWith('.xls')) {
            throw new HttpError(415, 'Format .xls lama belum didukung. Simpan file sebagai .xlsx atau .csv.');
          }
          result = await parseExcelOrCsvBuffer(rawBuffer, fileName);
        }
        sendJson(response, 200, { ok: true, ...result });
        return;
      }

      if (pathname === '/api/jobs' && request.method === 'PUT') {
        const body = await readJsonBody(request);
        const submittedJobs = validateJobs(body?.jobs);
        const operation = saveQueue.then(async () => {
          const previousJobs = jobs;
          const previousById = new Map(jobs.map((job) => [job.id, job]));
          if (
            role !== 'admin'
            && jobs.some((job) => !submittedJobs.some((submitted) => submitted.id === job.id))
          ) {
            throw new HttpError(403, 'Hanya admin yang dapat menghapus data lamaran.');
          }
          if (role !== 'admin') {
            for (const job of submittedJobs) {
              const previous = previousById.get(job.id);
              if (previous) {
                const changed = Object.keys(previous).some(
                  (key) => key !== 'createdBy' && job[key] !== previous[key],
                );
                if (changed) {
                  throw new HttpError(403, 'Hanya admin yang dapat mengubah data lamaran.');
                }
              } else if (job.status !== 'to_apply') {
                throw new HttpError(403, 'Lamaran baru harus menggunakan status "Akan dilamar".');
              }
            }
          }
          const updatedJobs = submittedJobs.map((job) => {
            const previous = previousById.get(job.id);
            return {
              ...job,
              createdBy: previous
                ? previous.createdBy
                : job.createdAt ? username : '',
            };
          });
          await fs.mkdir(path.dirname(dataFile), { recursive: true });
          const temporaryFile = `${dataFile}.tmp`;
          await fs.writeFile(temporaryFile, `${JSON.stringify(updatedJobs, null, 2)}\n`, 'utf8');
          await fs.rename(temporaryFile, dataFile);
          jobs = updatedJobs;
          hasSavedData = true;
          for (const job of submittedJobs) {
            const previous = previousById.get(job.id);
            if (!previous) {
              recordActivity(username, 'job_added', `Menambahkan lamaran ${job.company} — ${job.role}`);
            } else if (Object.keys(previous).some((key) => key !== 'createdBy' && job[key] !== previous[key])) {
              recordActivity(username, 'job_edited', `Mengubah lamaran ${job.company} — ${job.role}`);
            }
          }
          const submittedIds = new Set(submittedJobs.map((job) => job.id));
          for (const job of previousJobs) {
            if (!submittedIds.has(job.id)) {
              recordActivity(username, 'job_deleted', `Menghapus lamaran ${job.company} — ${job.role}`);
            }
          }
        });
        saveQueue = operation.catch(() => {});
        await operation;
        sendJson(response, 200, { ok: true, count: jobs.length });
        return;
      }

      if (pathname === '/api/health' && request.method === 'GET') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && (pathname === '/' || pathname === '/helmy_job_tracker.html')) {
        const [html, dashboardScript, dashboardStyle] = await Promise.all([
          fs.readFile(htmlPath, 'utf8'),
          fs.readFile(dashboardScriptPath, 'utf8'),
          fs.readFile(dashboardStylePath, 'utf8'),
        ]);
        const enhancedHtml = updateImportFormatCopy(html)
          .replace('</head>', `<style>${dashboardStyle}</style></head>`)
          .replace('</body>', `<script>${dashboardScript}</script></body>`);
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(enhancedHtml);
        return;
      }

      sendJson(response, 404, { error: 'Halaman atau endpoint tidak ditemukan.' });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error('Permintaan gagal:', error);
      sendJson(response, 500, { error: 'Terjadi kesalahan saat memproses permintaan.' });
    }
  });

  server.ready = ready;
  return server;
}

if (require.main === module) {
  try {
    const server = createServer();
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
    server.on('error', (error) => {
      console.error('Server gagal dijalankan:', error);
      process.exitCode = 1;
    });
    server.ready.then(() => {
      server.listen(port, host, () => {
        console.log(`Job Tracker berjalan di http://${host}:${port}`);
        if (process.env.APP_PASSWORD) console.log('Perlindungan kata sandi aktif.');
      });
    }).catch((error) => {
      console.error('Data penyimpanan gagal dibuka:', error);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  createServer,
  parseMatrixToJobs,
  parseCsv,
  parseExcelOrCsvBuffer,
};
