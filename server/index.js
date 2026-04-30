import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import readXlsxFile from 'read-excel-file/node';
import { parse as parseCsv } from 'csv-parse/sync';
import iconv from 'iconv-lite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const PORT = Number(process.env.PORT || 3000);
const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || '').replace(/\/+$/, '');
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || '';
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '';
const CHATWOOT_INBOX_ID = process.env.CHATWOOT_INBOX_ID || '';
const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE || '').replace(/[^\d]/g, '');
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 350);
const APP_PASSWORD = process.env.APP_PASSWORD || '';

const jobs = new Map();
const labelCache = new Map();

app.use(express.json({ limit: '1mb' }));

function isConfigured() {
  return Boolean(CHATWOOT_BASE_URL && CHATWOOT_API_TOKEN && CHATWOOT_ACCOUNT_ID);
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requirePassword(req, res, next) {
  if (!APP_PASSWORD) {
    next();
    return;
  }

  const provided = req.get('x-app-password') || req.body?.appPassword || '';
  if (!sameSecret(provided, APP_PASSWORD)) {
    res.status(401).json({ message: 'كلمة مرور الأداة غير صحيحة.' });
    return;
  }

  next();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toArabicDigitsSafe(value) {
  return String(value || '')
    .replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
    .replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));
}

function normalizePhone(value) {
  const original = toArabicDigitsSafe(value).trim();
  let phone = original.replace(/[^\d+]/g, '');

  if (phone.startsWith('00')) {
    phone = `+${phone.slice(2)}`;
  }

  if (phone.startsWith('+')) {
    phone = `+${phone.slice(1).replace(/[^\d]/g, '')}`;
  } else if (DEFAULT_COUNTRY_CODE && phone.startsWith('0')) {
    phone = `+${DEFAULT_COUNTRY_CODE}${phone.replace(/^0+/, '')}`;
  } else if (DEFAULT_COUNTRY_CODE && phone.startsWith(`${DEFAULT_COUNTRY_CODE}0`)) {
    phone = `+${DEFAULT_COUNTRY_CODE}${phone.slice(DEFAULT_COUNTRY_CODE.length + 1)}`;
  } else {
    phone = `+${phone}`;
  }

  if (DEFAULT_COUNTRY_CODE && phone.startsWith(`+${DEFAULT_COUNTRY_CODE}0`)) {
    phone = `+${DEFAULT_COUNTRY_CODE}${phone.slice(DEFAULT_COUNTRY_CODE.length + 2)}`;
  }

  return phone;
}

function phoneDigits(value) {
  return normalizePhone(value).replace(/\D/g, '');
}

function uniquePhoneQueries(value) {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/\D/g, '');
  const raw = toArabicDigitsSafe(value).trim().replace(/[^\d+]/g, '');
  return [...new Set([normalized, digits, raw].filter(Boolean))];
}

function normalizeLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeName(value) {
  const name = String(value || '').trim();
  return name || 'No Name';
}

function decodeCsvBuffer(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return iconv.decode(buffer, 'utf16le');
  }

  const candidates = [
    iconv.decode(buffer, 'utf8'),
    iconv.decode(buffer, 'windows-1256'),
    iconv.decode(buffer, 'windows-1252'),
  ];

  return candidates
    .map(text => ({
      text,
      replacementCount: (text.match(/\uFFFD/g) || []).length,
      arabicCount: (text.match(/[\u0600-\u06FF]/g) || []).length,
    }))
    .sort((a, b) => a.replacementCount - b.replacementCount || b.arabicCount - a.arabicCount)[0].text;
}

function cleanObjectKeys(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [String(key).trim(), value == null ? '' : String(value).trim()]),
  );
}

function valueToText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

async function parseUploadedFile(file) {
  if (!file) {
    throw new Error('لم يتم رفع ملف.');
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  let rows = [];

  if (ext === '.xlsx') {
    const sheetRows = await readXlsxFile(file.buffer);
    if (!sheetRows.length) {
      throw new Error('ملف Excel لا يحتوي على Sheets.');
    }
    const columns = sheetRows[0].map(valueToText).filter(Boolean);
    if (!columns.length) {
      throw new Error('لم يتم العثور على Header Row في ملف Excel.');
    }
    rows = sheetRows.slice(1).map(row => {
      const item = {};
      columns.forEach((column, index) => {
        item[column] = valueToText(row[index]);
      });
      return item;
    }).filter(item => Object.values(item).some(Boolean));
  } else if (ext === '.xls') {
    throw new Error('صيغة XLS القديمة غير مدعومة لأسباب أمان. احفظ الملف كـ XLSX أو CSV.');
  } else {
    const text = decodeCsvBuffer(file.buffer);
    rows = parseCsv(text, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
    });
  }

  const cleanedRows = rows.map(cleanObjectKeys);
  const columns = [...new Set(cleanedRows.flatMap(row => Object.keys(row)))];
  return { rows: cleanedRows, columns };
}

function pickDefaultMapping(columns) {
  const findColumn = names => columns.find(column => names.some(name => column.toLowerCase().trim() === name));
  const fuzzyColumn = words => columns.find(column => words.some(word => column.toLowerCase().includes(word)));

  return {
    name: findColumn(['name', 'full_name', 'contact_name', 'الاسم', 'اسم العميل']) || fuzzyColumn(['name', 'اسم']) || columns[0] || '',
    phone:
      findColumn(['phone_number', 'phone', 'mobile', 'mobile_number', 'رقم الهاتف', 'رقم الموبايل']) ||
      fuzzyColumn(['phone', 'mobile', 'رقم']) ||
      columns[1] ||
      '',
    label:
      findColumn(['custom_attribute_1', 'label', 'labels', 'tag', 'segment', 'ليبل']) ||
      fuzzyColumn(['custom_attribute', 'label', 'tag', 'ليبل']) ||
      columns[2] ||
      '',
  };
}

function extractArrayPayload(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.payload)) return data.payload;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function extractContact(data) {
  if (data?.payload?.contact) return data.payload.contact;
  if (data?.payload?.id) return data.payload;
  if (data?.contact?.id) return data.contact;
  if (data?.id) return data;
  const payload = extractArrayPayload(data);
  return payload[0] || null;
}

function extractLabelTitles(data) {
  const payload = extractArrayPayload(data);
  if (payload.length) {
    return payload.map(item => (typeof item === 'string' ? item : item.title || item.name)).filter(Boolean);
  }
  if (Array.isArray(data?.payload?.labels)) return data.payload.labels;
  if (Array.isArray(data?.labels)) return data.labels;
  return [];
}

async function chatwootFetch(endpoint, options = {}, retries = 4) {
  if (!isConfigured()) {
    throw new Error('إعدادات Chatwoot غير مكتملة في Environment Variables.');
  }

  const url = `${CHATWOOT_BASE_URL}${endpoint}`;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          api_access_token: CHATWOOT_API_TOKEN,
          ...(options.headers || {}),
        },
      });

      const text = await response.text();
      const data = text ? JSON.parse(text) : null;

      if (!response.ok) {
        const message = data?.message || data?.error || `Chatwoot HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.data = data;

        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < retries) {
          lastError = error;
          await sleep(900 * (attempt + 1));
          continue;
        }

        throw error;
      }

      return data;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(900 * (attempt + 1));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function refreshLabels() {
  const data = await chatwootFetch(`/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/labels`, { method: 'GET' });
  const labels = extractArrayPayload(data);
  labelCache.clear();
  for (const label of labels) {
    const title = typeof label === 'string' ? label : label.title || label.name;
    if (title) labelCache.set(title.toLowerCase(), { title, created: false });
  }
}

async function ensureLabel(title) {
  const label = normalizeLabel(title);
  const key = label.toLowerCase();
  if (!labelCache.size) await refreshLabels();
  if (labelCache.has(key)) return labelCache.get(key);

  try {
    const data = await chatwootFetch(`/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        label: {
          title: label,
          description: 'Created by Chatwoot Smart Importer',
          color: '#0f766e',
          show_on_sidebar: true,
        },
      }),
    });
    const createdTitle = data?.payload?.title || data?.title || label;
    const result = { title: createdTitle, created: true };
    labelCache.set(createdTitle.toLowerCase(), result);
    return result;
  } catch (error) {
    if (error.status === 422 || error.status === 409) {
      await refreshLabels();
      if (labelCache.has(key)) return labelCache.get(key);
    }
    throw error;
  }
}

function contactMatchesPhone(contact, wantedDigits) {
  if (!contact?.phone_number) return false;
  return phoneDigits(contact.phone_number) === wantedDigits;
}

async function searchContactByPhone(phone) {
  const wantedDigits = phoneDigits(phone);

  for (const query of uniquePhoneQueries(phone)) {
    const data = await chatwootFetch(
      `/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(query)}`,
      { method: 'GET' },
    );
    const contacts = extractArrayPayload(data);
    const exact = contacts.find(contact => contactMatchesPhone(contact, wantedDigits));
    if (exact) return exact;
    if (contacts.length === 1) return contacts[0];
  }

  return null;
}

async function createContact(name, phone) {
  if (!CHATWOOT_INBOX_ID) {
    throw new Error('CHATWOOT_INBOX_ID مطلوب لإنشاء Contacts جديدة. ضعه في Environment Variables على Coolify.');
  }

  const data = await chatwootFetch(`/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`, {
    method: 'POST',
    body: JSON.stringify({
      inbox_id: Number(CHATWOOT_INBOX_ID),
      name: normalizeName(name),
      phone_number: normalizePhone(phone),
    }),
  });

  const contact = extractContact(data);
  if (!contact?.id) {
    throw new Error('Chatwoot لم يرجع contact id بعد إنشاء الكونتاكت.');
  }
  return contact;
}

async function findOrCreateContact(name, phone, createMissingContacts) {
  const existing = await searchContactByPhone(phone);
  if (existing?.id) return { contact: existing, created: false };

  if (!createMissingContacts) {
    return { contact: null, created: false };
  }

  try {
    const created = await createContact(name, phone);
    return { contact: created, created: true };
  } catch (error) {
    if (error.status === 400 || error.status === 422 || error.status === 409) {
      const retry = await searchContactByPhone(phone);
      if (retry?.id) return { contact: retry, created: false };
    }
    throw error;
  }
}

async function assignLabelToContact(contactId, labelTitle) {
  const currentData = await chatwootFetch(
    `/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${contactId}/labels`,
    { method: 'GET' },
  );
  const existingLabels = extractLabelTitles(currentData);
  const merged = [...new Set([...existingLabels, labelTitle])];

  const updateData = await chatwootFetch(`/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${contactId}/labels`, {
    method: 'POST',
    body: JSON.stringify({ labels: merged }),
  });
  const savedLabels = extractLabelTitles(updateData);
  return savedLabels.some(label => label.toLowerCase() === labelTitle.toLowerCase());
}

function createJob(rows, mapping, options) {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mapping,
    options,
    stats: {
      total: rows.length,
      processed: 0,
      labeled: 0,
      createdContacts: 0,
      existingContacts: 0,
      labelsCreated: 0,
      skipped: 0,
      duplicateRows: 0,
      notFound: 0,
      failed: 0,
    },
    logs: [],
    failures: [],
  };

  jobs.set(id, job);
  return job;
}

function pushLog(job, type, message, rowNumber = null) {
  job.logs.unshift({
    id: crypto.randomUUID(),
    type,
    message,
    rowNumber,
    time: new Date().toISOString(),
  });
  job.logs = job.logs.slice(0, 500);
  job.updatedAt = new Date().toISOString();
}

function getCell(row, column) {
  return column ? String(row[column] || '').trim() : '';
}

function validateMapping(columns, mapping) {
  const missing = [];
  if (!mapping.phone || !columns.includes(mapping.phone)) missing.push('رقم الهاتف');
  if (!mapping.label || !columns.includes(mapping.label)) missing.push('اسم الليبل');
  if (missing.length) {
    throw new Error(`حدد الأعمدة المطلوبة: ${missing.join('، ')}`);
  }
}

async function runJob(job, rows) {
  job.status = 'running';
  pushLog(job, 'info', 'بدأت عملية الاستيراد.');

  const seen = new Set();
  const { mapping, options } = job;
  const createMissingContacts = options.createMissingContacts !== false;
  const skipDuplicateRows = options.skipDuplicateRows !== false;
  const delayMs = Number(options.delayMs || REQUEST_DELAY_MS);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;
    const name = normalizeName(getCell(row, mapping.name));
    const rawPhone = getCell(row, mapping.phone);
    const rawLabel = normalizeLabel(getCell(row, mapping.label));

    try {
      if (!rawPhone || !rawLabel) {
        job.stats.skipped += 1;
        pushLog(job, 'warning', 'تم تخطي السطر لأن رقم الهاتف أو الليبل فارغ.', rowNumber);
        continue;
      }

      const normalizedPhone = normalizePhone(rawPhone);
      const dedupeKey = `${phoneDigits(normalizedPhone)}|${rawLabel.toLowerCase()}`;
      if (skipDuplicateRows && seen.has(dedupeKey)) {
        job.stats.duplicateRows += 1;
        pushLog(job, 'info', `سطر مكرر تم تخطيه: ${normalizedPhone} -> ${rawLabel}`, rowNumber);
        continue;
      }
      seen.add(dedupeKey);

      const label = await ensureLabel(rawLabel);
      if (label.created) {
        job.stats.labelsCreated += 1;
        pushLog(job, 'success', `تم إنشاء الليبل: ${label.title}`, rowNumber);
      }

      const { contact, created } = await findOrCreateContact(name, normalizedPhone, createMissingContacts);
      if (!contact?.id) {
        job.stats.notFound += 1;
        pushLog(job, 'warning', `لم يتم العثور على الرقم ولم يتم إنشاء كونتاكت: ${normalizedPhone}`, rowNumber);
        continue;
      }

      if (created) job.stats.createdContacts += 1;
      else job.stats.existingContacts += 1;

      const linked = await assignLabelToContact(contact.id, label.title);
      if (!linked) {
        throw new Error('Chatwoot لم يؤكد حفظ الليبل على الكونتاكت.');
      }

      job.stats.labeled += 1;
      pushLog(job, 'success', `${created ? 'إنشاء وربط' : 'ربط'}: ${name} (${normalizedPhone}) -> ${label.title}`, rowNumber);
    } catch (error) {
      job.stats.failed += 1;
      job.failures.push({
        rowNumber,
        name,
        phone: rawPhone,
        label: rawLabel,
        error: error.message,
      });
      pushLog(job, 'error', `فشل السطر ${rowNumber}: ${error.message}`, rowNumber);
    } finally {
      job.stats.processed += 1;
      job.updatedAt = new Date().toISOString();
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  job.status = job.stats.failed > 0 ? 'completed_with_errors' : 'completed';
  pushLog(job, job.stats.failed > 0 ? 'warning' : 'success', 'انتهت عملية الاستيراد.');
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: isConfigured() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    requiresPassword: Boolean(APP_PASSWORD),
    configured: isConfigured(),
    hasInboxId: Boolean(CHATWOOT_INBOX_ID),
    baseUrl: CHATWOOT_BASE_URL || null,
    accountId: CHATWOOT_ACCOUNT_ID || null,
    defaultCountryCode: DEFAULT_COUNTRY_CODE || null,
    requestDelayMs: REQUEST_DELAY_MS,
  });
});

app.post('/api/preview', requirePassword, upload.single('file'), async (req, res) => {
  try {
    const parsed = await parseUploadedFile(req.file);
    res.json({
      total: parsed.rows.length,
      columns: parsed.columns,
      sample: parsed.rows.slice(0, 5),
      suggestedMapping: pickDefaultMapping(parsed.columns),
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.post('/api/import-jobs', requirePassword, upload.single('file'), async (req, res) => {
  try {
    const parsed = await parseUploadedFile(req.file);
    const mapping = JSON.parse(req.body.mapping || '{}');
    const options = JSON.parse(req.body.options || '{}');
    validateMapping(parsed.columns, mapping);

    const job = createJob(parsed.rows, mapping, options);
    res.status(202).json({ jobId: job.id, job });

    queueMicrotask(() => {
      runJob(job, parsed.rows).catch(error => {
        job.status = 'failed';
        job.stats.failed += 1;
        pushLog(job, 'error', `فشلت العملية بالكامل: ${error.message}`);
      });
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/api/import-jobs/:id', requirePassword, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ message: 'Job غير موجودة أو السيرفر اتعمله Restart.' });
    return;
  }
  res.json({ job });
});

app.get('/api/import-jobs/:id/failures.csv', requirePassword, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).send('job not found');
    return;
  }

  const header = 'rowNumber,name,phone,label,error\n';
  const body = job.failures
    .map(item =>
      [item.rowNumber, item.name, item.phone, item.label, item.error]
        .map(value => `"${String(value || '').replace(/"/g, '""')}"`)
        .join(','),
    )
    .join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="chatwoot-import-failures-${job.id}.csv"`);
  res.send(`${header}${body}`);
});

const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Chatwoot Smart Importer is running on port ${PORT}`);
});

export { app, server };
