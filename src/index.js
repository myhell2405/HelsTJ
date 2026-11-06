import ExcelJS from 'exceljs';

const SESSION_COOKIE = 'job_tracker_session';
const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_JSON_BYTES = 5 * 1024 * 1024;
const PASSWORD_ITERATIONS = 100000;
const STATUSES = new Set([
  'applied',
  'in_process',
  'rejected',
  'to_apply',
  'verify',
  'watchlist',
  'closed',
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function cookieOptions(maxAge) {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function parseCookie(request) {
  const cookie = (request.headers.get('Cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : '';
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function digest(value) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(result));
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(salt),
    iterations: PASSWORD_ITERATIONS,
  }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function ensureBootstrapAdmin(db, env) {
  const username = env.ADMIN_USERNAME?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('Atur ADMIN_USERNAME dan ADMIN_PASSWORD sebagai Cloudflare Worker secrets.');
  }
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username) || password.length < 12) {
    throw new Error('Username admin harus 3–32 karakter dan password minimal 12 karakter.');
  }

  const existingAdmin = await db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").first();
  if (existingAdmin) return;

  const salt = randomHex(16);
  const hash = await passwordHash(password, salt);
  await db.prepare(
    'INSERT OR IGNORE INTO users (username, password_hash, salt, role, active) VALUES (?, ?, ?, ?, 1)',
  ).bind(username, hash, salt, 'admin').run();
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > maxBytes) {
    throw new HttpError(413, 'Ukuran permintaan terlalu besar.');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new HttpError(413, 'Ukuran permintaan terlalu besar.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Isi permintaan bukan JSON yang valid.');
  }
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
    if (!STATUSES.has(status)) throw new HttpError(400, 'Status lamaran tidak dikenal.');
    const employerType = text('employerType', 20);
    if (!['', 'government', 'private'].includes(employerType)) {
      throw new HttpError(400, 'Jenis pemberi kerja harus pemerintah atau swasta.');
    }
    return {
      id: job.id,
      company: text('company', 200, true),
      role: text('role', 300, true),
      category: text('category', 100) || 'Lainnya',
      location: text('location', 150),
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

function normalizeJobName(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id');
}

function jobIdentity(job) {
  return JSON.stringify([normalizeJobName(job.company), normalizeJobName(job.role)]);
}

function assertNoDuplicateJob(job, jobs, excludeId) {
  const identity = jobIdentity(job);
  if (jobs.some((existing) => existing.id !== excludeId && jobIdentity(existing) === identity)) {
    throw new HttpError(
      409,
      `Lowongan ${job.role} di ${job.company} sudah terdaftar. Periksa nama posisi dan perusahaan.`,
    );
  }
}

function validateOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, 'Permintaan lintas situs tidak diizinkan.');
  }
}

async function getSession(request, db) {
  const rawToken = parseCookie(request);
  if (!rawToken) return null;
  const tokenHash = await digest(rawToken);
  const row = await db.prepare(
    `SELECT users.id, users.username, users.role
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1`,
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
  return row || null;
}

async function requireSession(request, env) {
  const session = await getSession(request, env.DB);
  if (!session) throw new HttpError(401, 'Sesi login berakhir. Silakan masuk kembali.');
  return session;
}

function requireAdmin(session) {
  if (session.role !== 'admin') throw new HttpError(403, 'Fitur ini khusus admin.');
}

function getJakartaDates() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  return { today, yesterday };
}

async function getDailyNotes(db) {
  const { today, yesterday } = getJakartaDates();
  await db.prepare('DELETE FROM admin_daily_notes WHERE note_date < ?').bind(yesterday).run();
  const result = await db.prepare(
    'SELECT note_date, note, updated_at FROM admin_daily_notes WHERE note_date >= ? ORDER BY note_date DESC',
  ).bind(yesterday).all();
  return { todayDate: today, yesterdayDate: yesterday, notes: result.results };
}

async function checkLoginRateLimit(db, ip) {
  const now = Date.now();
  const existing = await db.prepare(
    'SELECT window_started_at, attempt_count FROM login_attempts WHERE ip_address = ?',
  ).bind(ip).first();
  if (!existing || existing.window_started_at + LOGIN_WINDOW_MS <= now) {
    await db.prepare(
      `INSERT INTO login_attempts (ip_address, window_started_at, attempt_count) VALUES (?, ?, 0)
       ON CONFLICT(ip_address) DO UPDATE SET window_started_at = excluded.window_started_at, attempt_count = 0`,
    ).bind(ip, now).run();
    return 0;
  }
  return existing.attempt_count;
}

async function handleLogin(request, env) {
  validateOrigin(request);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const attempts = await checkLoginRateLimit(env.DB, ip);
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    return json({ error: 'Terlalu banyak percobaan. Coba lagi 15 menit kemudian.' }, 429);
  }
  const credentials = await readJson(request);
  const username = typeof credentials?.username === 'string' ? credentials.username.trim() : '';
  const password = typeof credentials?.password === 'string' ? credentials.password : '';
  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, salt, role FROM users WHERE username = ? COLLATE NOCASE AND active = 1',
  ).bind(username).first();
  const suppliedHash = user ? await passwordHash(password, user.salt) : await passwordHash(password, 'job-tracker-invalid-user');
  if (!user || !constantTimeEqual(suppliedHash, user.password_hash)) {
    await env.DB.prepare(
      'UPDATE login_attempts SET attempt_count = attempt_count + 1 WHERE ip_address = ?',
    ).bind(ip).run();
    return json({ error: 'Nama pengguna atau kata sandi salah.' }, 401);
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE ip_address = ?').bind(ip).run();
  const rawToken = randomHex(32);
  const tokenHash = await digest(rawToken);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
  ).bind(tokenHash, user.id, expiresAt).run();
  return json({ ok: true }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=${rawToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`,
  });
}

async function handleUsers(request, env, session, url) {
  requireAdmin(session);
  if (request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT id, username, role, active, created_at FROM users ORDER BY id',
    ).all();
    return json({ users: result.results });
  }
  if (request.method === 'POST') {
    validateOrigin(request);
    const body = await readJson(request);
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      throw new HttpError(400, 'Username harus 3–32 karakter: huruf, angka, titik, garis bawah, atau strip.');
    }
    if (password.length < 12 || password.length > 256) {
      throw new HttpError(400, 'Kata sandi harus minimal 12 dan maksimal 256 karakter.');
    }
    const salt = randomHex(16);
    const hash = await passwordHash(password, salt);
    try {
      const results = await env.DB.batch([
        env.DB.prepare(
        'INSERT INTO users (username, password_hash, salt, role, active) VALUES (?, ?, ?, ?, 1)',
        ).bind(username, hash, salt, 'user'),
        env.DB.prepare(
          "INSERT INTO activity_log (actor_username, action, summary) VALUES (?, 'user_added', ?)",
        ).bind(session.username, `Membuat akun pengguna ${username}`),
      ]);
      const result = results[0];
      return json({ ok: true, user: { id: result.meta.last_row_id, username, role: 'user', active: 1 } }, 201);
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        throw new HttpError(409, 'Username sudah digunakan.');
      }
      throw error;
    }
  }

  const match = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (request.method === 'DELETE' && match) {
    validateOrigin(request);
    const userId = Number(match[1]);
    if (!Number.isSafeInteger(userId) || userId === session.id) {
      throw new HttpError(400, 'Admin tidak dapat menghapus akunnya sendiri.');
    }
    const target = await env.DB.prepare('SELECT id, username, role FROM users WHERE id = ?').bind(userId).first();
    if (!target || target.role === 'admin') throw new HttpError(404, 'Pengguna tidak ditemukan.');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
      env.DB.prepare(
        "INSERT INTO activity_log (actor_username, action, summary) VALUES (?, 'user_deleted', ?)",
      ).bind(session.username, `Menghapus akun pengguna ${target.username}`),
    ]);
    return json({ ok: true });
  }
  throw new HttpError(404, 'Endpoint tidak ditemukan.');
}

const FIELD_SYNONYMS = {
  company: ['company', 'perusahaan', 'namaperusahaan', 'companyname', 'instansi', 'organisasi', 'namaorganisasi'],
  role: ['role', 'posisi', 'jabatan', 'jobtitle', 'title', 'pekerjaan', 'posisijob', 'lowongan', 'posisipekerjaan'],
  category: ['category', 'kategori', 'bidang', 'divisi', 'departemen'],
  location: ['location', 'lokasi', 'wilayah', 'area'],
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
      location: String(rowObj.location || '').trim() || 'Jabodetabek',
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

async function exportXlsx(request) {
  const body = await readJson(request);
  const jobs = validateJobs(body?.jobs);
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
    { header: 'Lokasi', key: 'location', width: 24 },
  ];
  worksheet.addRows(jobs);
  worksheet.getRow(1).font = { bold: true };
  const file = await workbook.xlsx.writeBuffer();
  return new Response(Buffer.from(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="helmy-job-tracker.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === 'GET' && ['/login', '/login/', '/login.html'].includes(pathname)) {
    return env.ASSETS.fetch(new Request(new URL('/login/', request.url), request));
  }

  if (pathname === '/api/session' && request.method === 'GET') {
    const session = await getSession(request, env.DB);
    return json({ authenticated: Boolean(session) });
  }
  if (pathname === '/api/login' && request.method === 'POST') {
    await ensureBootstrapAdmin(env.DB, env);
    return handleLogin(request, env);
  }

  if (pathname === '/api/jobs' && request.method === 'GET') {
    const stored = await env.DB.prepare('SELECT jobs_json FROM shared_jobs WHERE id = 1').first();
    if (!stored) return json({ jobs: [], initialized: false });
    let jobs;
    try {
      jobs = validateJobs(JSON.parse(stored.jobs_json));
    } catch (error) {
      console.error('Data bersama di D1 tidak valid:', error);
      throw new HttpError(500, 'Data tracker tersimpan tetapi tidak dapat dibaca.');
    }
    const session = await getSession(request, env.DB);
    return json({
      jobs: session?.role === 'admin' ? jobs : jobs.map((job) => ({
        id: job.id,
        company: job.company,
        role: job.role,
        category: job.category,
        location: job.location || 'Jabodetabek',
        sector: job.sector,
        employerType: job.employerType,
        deadline: job.deadline,
        source: job.source,
        sourceUrl: job.sourceUrl,
        applicationUrl: job.applicationUrl,
      })),
      initialized: true,
    });
  }

  if (pathname === '/api/suggestions' && request.method === 'POST') {
    validateOrigin(request);
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) throw new HttpError(429, 'Pengiriman belum tersedia. Coba lagi nanti.');
    const now = Math.floor(Date.now() / 1000);
    const body = await readJson(request);
    const text = (field, maxLength, required = false) => {
      const value = body?.[field] ?? '';
      if (typeof value !== 'string' || value.length > maxLength || (required && !value.trim())) {
        throw new HttpError(400, `Nilai ${field} tidak valid.`);
      }
      return value.trim();
    };
    const suggestion = {
      company: text('company', 200, true),
      role: text('role', 300, true),
      category: text('category', 100) || 'Lainnya',
      location: text('location', 150) || 'Jabodetabek',
      deadline: text('deadline', 200),
      source: text('source', 1000),
      sourceUrl: text('sourceUrl', 2000),
      applicationUrl: text('applicationUrl', 2000),
      note: text('note', 5000),
    };
    const submitterName = text('submitterName', 100, true);
    const relationship = text('relationship', 150, true);
    for (const field of ['sourceUrl', 'applicationUrl']) {
      if (suggestion[field]) {
        let parsed;
        try {
          parsed = new URL(suggestion[field]);
        } catch {
          throw new HttpError(400, `Nilai ${field} harus berupa URL yang valid.`);
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new HttpError(400, `Nilai ${field} harus menggunakan HTTP atau HTTPS.`);
        }
      }
    }
    const rateKey = await digest(ip);
    await env.DB.prepare(
      'DELETE FROM suggestion_rate_limits WHERE window_started_at + 900 <= ?',
    ).bind(now).run();
    const rate = await env.DB.prepare(
      `INSERT INTO suggestion_rate_limits (ip_hash, window_started_at, submission_count)
       VALUES (?, ?, 1) ON CONFLICT(ip_hash) DO UPDATE SET
       submission_count = CASE WHEN suggestion_rate_limits.window_started_at + 900 <= ?
         THEN 1 ELSE suggestion_rate_limits.submission_count + 1 END,
       window_started_at = CASE WHEN suggestion_rate_limits.window_started_at + 900 <= ?
         THEN excluded.window_started_at ELSE suggestion_rate_limits.window_started_at END
       RETURNING submission_count`,
    ).bind(rateKey, now, now, now).first();
    if (rate.submission_count > 5) {
      throw new HttpError(429, 'Terlalu banyak kiriman. Coba lagi dalam 15 menit.');
    }
    await env.DB.prepare(
      'INSERT INTO public_suggestions (job_json, submitter_name, relationship) VALUES (?, ?, ?)',
    )
      .bind(JSON.stringify(suggestion), submitterName, relationship)
      .run();
    return json({ ok: true }, 201);
  }

  if (request.method === 'GET' && pathname === '/helmy_job_tracker.html') {
    return Response.redirect(new URL('/', request.url), 302);
  }
  if (request.method === 'GET' && !pathname.startsWith('/api/')) {
    return env.ASSETS.fetch(request);
  }

  await ensureBootstrapAdmin(env.DB, env);

  const session = await getSession(request, env.DB);
  if (!session) {
    return json({ error: 'Sesi login berakhir. Silakan masuk kembali.' }, 401);
  }

  if (pathname === '/api/logout' && request.method === 'POST') {
    validateOrigin(request);
    const tokenHash = await digest(parseCookie(request));
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookieOptions(0) });
  }
  if (pathname === '/api/config' && request.method === 'GET') {
    return json({
      googleClientId: env.GOOGLE_CLIENT_ID || '',
      currentUser: { id: session.id, username: session.username, role: session.role },
    });
  }
  if (pathname === '/api/users' || pathname.startsWith('/api/users/')) {
    return handleUsers(request, env, session, url);
  }
  if (pathname === '/api/todos' && request.method === 'GET') {
    requireAdmin(session);
    const result = await env.DB.prepare(
      'SELECT id, parent_id, title, completed, created_at FROM admin_todos ORDER BY id',
    ).all();
    return json({ todos: result.results });
  }
  if (pathname === '/api/todos' && request.method === 'POST') {
    validateOrigin(request);
    requireAdmin(session);
    const body = await readJson(request);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 300) {
      throw new HttpError(400, 'Judul tugas wajib diisi dan maksimal 300 karakter.');
    }
    const parentId = body?.parentId === undefined || body.parentId === null || body.parentId === ''
      ? null
      : body.parentId;
    if (parentId !== null) {
      if (!Number.isSafeInteger(parentId) || parentId < 1) {
        throw new HttpError(400, 'Induk tugas tidak valid.');
      }
      const parent = await env.DB.prepare('SELECT id FROM admin_todos WHERE id = ?')
        .bind(parentId)
        .first();
      if (!parent) throw new HttpError(404, 'Induk tugas tidak ditemukan.');
    }
    const result = await env.DB.prepare(
      'INSERT INTO admin_todos (parent_id, title) VALUES (?, ?)',
    ).bind(parentId, title).run();
    return json({
      ok: true,
      todo: { id: result.meta.last_row_id, parent_id: parentId, title, completed: 0 },
    }, 201);
  }
  const todoMatch = pathname.match(/^\/api\/todos\/(\d+)$/);
  if (todoMatch && request.method === 'PATCH') {
    validateOrigin(request);
    requireAdmin(session);
    const todoId = Number(todoMatch[1]);
    if (!Number.isSafeInteger(todoId) || todoId < 1) {
      throw new HttpError(400, 'ID tugas tidak valid.');
    }
    const body = await readJson(request);
    const updates = [];
    const values = [];
    if (Object.hasOwn(body || {}, 'completed')) {
      if (typeof body.completed !== 'boolean') {
        throw new HttpError(400, 'Status tugas tidak valid.');
      }
      updates.push('completed = ?');
      values.push(body.completed ? 1 : 0);
    }
    if (Object.hasOwn(body || {}, 'title')) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 300) {
        throw new HttpError(400, 'Judul tugas wajib diisi dan maksimal 300 karakter.');
      }
      updates.push('title = ?');
      values.push(body.title.trim());
    }
    if (!updates.length) throw new HttpError(400, 'Tidak ada perubahan tugas.');
    values.push(todoId);
    const result = await env.DB.prepare(
      `UPDATE admin_todos SET ${updates.join(', ')} WHERE id = ?`,
    ).bind(...values).run();
    if (!result.meta.changes) throw new HttpError(404, 'Tugas tidak ditemukan.');
    return json({ ok: true });
  }
  if (todoMatch && request.method === 'DELETE') {
    validateOrigin(request);
    requireAdmin(session);
    const todoId = Number(todoMatch[1]);
    if (!Number.isSafeInteger(todoId) || todoId < 1) {
      throw new HttpError(400, 'ID tugas tidak valid.');
    }
    const result = await env.DB.prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM admin_todos WHERE id = ?
         UNION ALL
         SELECT todos.id FROM admin_todos todos
         JOIN descendants ON todos.parent_id = descendants.id
       )
       DELETE FROM admin_todos WHERE id IN (SELECT id FROM descendants)`,
    ).bind(todoId).run();
    if (!result.meta.changes) throw new HttpError(404, 'Tugas tidak ditemukan.');
    return json({ ok: true });
  }
  if (pathname === '/api/daily-notes' && request.method === 'GET') {
    requireAdmin(session);
    return json(await getDailyNotes(env.DB));
  }
  if (pathname === '/api/daily-notes' && request.method === 'PUT') {
    validateOrigin(request);
    requireAdmin(session);
    const body = await readJson(request);
    if (typeof body?.note !== 'string' || body.note.length > 10000) {
      throw new HttpError(400, 'Catatan wajib berupa teks maksimal 10.000 karakter.');
    }
    const { today } = getJakartaDates();
    await env.DB.prepare(
      `INSERT INTO admin_daily_notes (note_date, note, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(note_date) DO UPDATE SET note = excluded.note, updated_at = CURRENT_TIMESTAMP`,
    ).bind(today, body.note.trim()).run();
    return json({ ok: true, ...(await getDailyNotes(env.DB)) });
  }
  if (pathname === '/api/suggestions' && request.method === 'GET') {
    requireAdmin(session);
    const result = await env.DB.prepare(
      "SELECT id, job_json, submitter_name, relationship, submitted_at FROM public_suggestions WHERE status = 'pending' ORDER BY submitted_at DESC, id DESC LIMIT 100",
    ).all();
    return json({ suggestions: result.results.map((item) => ({
      id: item.id,
      job_json: item.job_json,
      submitter_name: item.submitter_name,
      relationship: item.relationship,
      submitted_at: item.submitted_at,
    })) });
  }
  const suggestionMatch = pathname.match(/^\/api\/suggestions\/(\d+)$/);
  if (request.method === 'PATCH' && suggestionMatch) {
    validateOrigin(request);
    requireAdmin(session);
    const suggestionId = Number(suggestionMatch[1]);
    if (!Number.isSafeInteger(suggestionId) || suggestionId < 1) {
      throw new HttpError(400, 'ID saran tidak valid.');
    }
    const body = await readJson(request);
    if (!['approve', 'reject'].includes(body?.decision)) {
      throw new HttpError(400, 'Keputusan tidak valid.');
    }
    const suggestion = await env.DB.prepare(
      "SELECT job_json, submitter_name FROM public_suggestions WHERE id = ? AND status = 'pending'",
    ).bind(suggestionId).first();
    if (!suggestion) throw new HttpError(404, 'Saran tidak ditemukan atau sudah ditinjau.');
    const now = new Date().toISOString();
    const statements = [];
    if (body.decision === 'approve') {
      const stored = await env.DB.prepare('SELECT jobs_json FROM shared_jobs WHERE id = 1').first();
      let jobs = [];
      if (stored) {
        try {
          jobs = validateJobs(JSON.parse(stored.jobs_json));
        } catch (error) {
          console.error('Data bersama di D1 tidak valid:', error);
          throw new HttpError(500, 'Data tracker tersimpan tetapi tidak dapat diperbarui.');
        }
      }
      let submitted;
      try {
        submitted = JSON.parse(suggestion.job_json);
      } catch {
        console.error('Saran lowongan tersimpan dalam format tidak valid:', suggestionId);
        throw new HttpError(500, 'Saran lowongan tidak dapat dibaca.');
      }
      const nextJob = {
        id: Math.max(0, ...jobs.map((job) => job.id)) + 1,
        company: submitted.company,
        role: submitted.role,
        category: submitted.category || 'Lainnya',
        location: submitted.location || 'Jabodetabek',
        sector: '',
        employerType: '',
        status: 'to_apply',
        deadline: submitted.deadline || '',
        source: submitted.source || '',
        sourceUrl: submitted.sourceUrl || '',
        applicationUrl: submitted.applicationUrl || '',
        note: submitted.note || '',
        createdAt: now,
        createdBy: suggestion.submitter_name || 'Komunitas',
        appliedDate: '',
        updated: now.slice(0, 10),
      };
      assertNoDuplicateJob(nextJob, jobs);
      const nextJobs = validateJobs([...jobs, nextJob]);
      statements.push(env.DB.prepare(
        `INSERT INTO shared_jobs (id, jobs_json, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET jobs_json = excluded.jobs_json, updated_at = CURRENT_TIMESTAMP`,
      ).bind(JSON.stringify(nextJobs)));
      statements.push(env.DB.prepare(
        "INSERT INTO activity_log (actor_username, action, summary) VALUES (?, 'job_added', ?)",
      ).bind(session.username, `Menerbitkan saran dari ${suggestion.submitter_name}: ${nextJob.company} — ${nextJob.role}`));
    }
    statements.push(env.DB.prepare(
      'INSERT INTO suggestion_review_log (actor_username, summary) VALUES (?, ?)',
    ).bind(
      session.username,
      body.decision === 'approve'
        ? `Menyetujui lowongan dari ${suggestion.submitter_name}`
        : `Menolak saran lowongan dari ${suggestion.submitter_name}`,
    ));
    statements.push(env.DB.prepare(
      'UPDATE public_suggestions SET status = ? WHERE id = ? AND status = ?',
    ).bind(body.decision === 'approve' ? 'approved' : 'rejected', suggestionId, 'pending'));
    await env.DB.batch(statements);
    return json({ ok: true });
  }
  if (pathname === '/api/activity' && request.method === 'GET') {
    requireAdmin(session);
    const result = await env.DB.prepare(
      `SELECT id, actor_username, action, summary, created_at FROM (
         SELECT id, actor_username, action, summary, created_at FROM activity_log
         UNION ALL
         SELECT -id AS id, actor_username, 'suggestion_review' AS action, summary, created_at FROM suggestion_review_log
       ) ORDER BY created_at DESC, id DESC LIMIT 50`,
    ).all();
    return json({ activities: result.results });
  }
  if (pathname === '/api/activity' && request.method === 'DELETE') {
    validateOrigin(request);
    requireAdmin(session);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM activity_log'),
      env.DB.prepare('DELETE FROM suggestion_review_log'),
    ]);
    return json({ ok: true });
  }
  const activityMatch = pathname.match(/^\/api\/activity\/(-?\d+)$/);
  if (request.method === 'DELETE' && activityMatch) {
    validateOrigin(request);
    requireAdmin(session);
    const activityId = Number(activityMatch[1]);
    if (!Number.isSafeInteger(activityId) || activityId === 0) {
      throw new HttpError(400, 'ID aktivitas tidak valid.');
    }
    const table = activityId < 0 ? 'suggestion_review_log' : 'activity_log';
    const result = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`)
      .bind(Math.abs(activityId))
      .run();
    if (!result.meta.changes) {
      throw new HttpError(404, 'Aktivitas tidak ditemukan.');
    }
    return json({ ok: true });
  }
  if (pathname === '/api/jobs' && request.method === 'PUT') {
    validateOrigin(request);
    requireAdmin(session);
    const body = await readJson(request);
    const submittedJobs = validateJobs(body?.jobs);
    const stored = await env.DB.prepare('SELECT jobs_json FROM shared_jobs WHERE id = 1').first();
    let previousJobs = [];
    if (stored) {
      try {
        previousJobs = validateJobs(JSON.parse(stored.jobs_json));
      } catch (error) {
        console.error('Data bersama di D1 tidak valid:', error);
        throw new HttpError(500, 'Data tracker tersimpan tetapi tidak dapat diperbarui.');
      }
    }
    const previousById = new Map(previousJobs.map((job) => [job.id, job]));
    const submittedIds = new Set(submittedJobs.map((job) => job.id));
    for (const job of submittedJobs) {
      const previous = previousById.get(job.id);
      if (!previous || jobIdentity(previous) !== jobIdentity(job)) {
        assertNoDuplicateJob(job, submittedJobs, job.id);
      }
    }
    const jobs = submittedJobs.map((job) => {
      const previous = previousById.get(job.id);
      return {
        ...job,
        createdBy: previous ? previous.createdBy : session.username,
      };
    });
    const activities = [];
    for (const job of submittedJobs) {
      const previous = previousById.get(job.id);
      if (!previous) {
        activities.push({
          action: 'job_added',
          summary: `Menambahkan lamaran ${job.company} — ${job.role}`,
        });
      } else if (Object.keys(previous).some((key) => key !== 'createdBy' && job[key] !== previous[key])) {
        activities.push({
          action: 'job_edited',
          summary: `Mengubah lamaran ${job.company} — ${job.role}`,
        });
      }
    }
    for (const job of previousJobs) {
      if (!submittedIds.has(job.id)) {
        activities.push({
          action: 'job_deleted',
          summary: `Menghapus lamaran ${job.company} — ${job.role}`,
        });
      }
    }
    const statements = [env.DB.prepare(
      `INSERT INTO shared_jobs (id, jobs_json, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET jobs_json = excluded.jobs_json, updated_at = CURRENT_TIMESTAMP`,
    ).bind(JSON.stringify(jobs))];
    for (const activity of activities.slice(-50)) {
      statements.push(env.DB.prepare(
        'INSERT INTO activity_log (actor_username, action, summary) VALUES (?, ?, ?)',
      ).bind(session.username, activity.action, activity.summary));
    }
    await env.DB.batch(statements);
    return json({ ok: true, count: jobs.length });
  }
  if (pathname === '/api/export/xlsx' && request.method === 'POST') {
    validateOrigin(request);
    requireAdmin(session);
    return exportXlsx(request);
  }
  if (pathname === '/api/import/parse' && request.method === 'POST') {
    validateOrigin(request);
    requireAdmin(session);
    const contentType = request.headers.get('Content-Type') || '';
    let result;
    if (contentType.includes('application/json')) {
      const body = await readJson(request, MAX_IMPORT_JSON_BYTES);
      if (typeof body?.csv === 'string') {
        const matrix = parseCsv(body.csv);
        result = parseMatrixToJobs(matrix);
      } else if (Array.isArray(body?.rows)) {
        result = parseMatrixToJobs(body.rows);
      } else {
        throw new HttpError(400, 'Data JSON tidak valid untuk parsing lowongan.');
      }
    } else {
      const declaredLength = Number(request.headers.get('Content-Length') || 0);
      if (declaredLength > MAX_BODY_BYTES) {
        throw new HttpError(413, 'Ukuran file melebihi batas maksimal 2MB.');
      }
      const arrayBuffer = await request.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_BODY_BYTES) {
        throw new HttpError(413, 'Ukuran file melebihi batas maksimal 2MB.');
      }
      const buffer = Buffer.from(arrayBuffer);
      const fileName = decodeURIComponent(request.headers.get('X-File-Name') || '');
      if (fileName.toLowerCase().endsWith('.xls')) {
        throw new HttpError(415, 'Format .xls lama belum didukung. Simpan file sebagai .xlsx atau .csv.');
      }
      result = await parseExcelOrCsvBuffer(buffer, fileName);
    }
    return json({ ok: true, ...result });
  }

  throw new HttpError(404, 'Endpoint tidak ditemukan.');
}

export default {
  async fetch(request, env) {
    try {
      const response = await route(request, env);
      const headers = new Headers(response.headers);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Frame-Options', 'DENY');
      headers.set('Referrer-Policy', 'same-origin');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error('Cloudflare Worker request failed:', error);
      return json({ error: 'Terjadi kesalahan saat memproses permintaan.' }, 500);
    }
  },
};
