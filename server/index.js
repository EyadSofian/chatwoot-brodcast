const express = require('express');
const multer = require('multer');
const csv = require('csv-parse/sync');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));

// --- إعدادات البيئة ---
const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL;
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const INBOX_ID = process.env.CHATWOOT_INBOX_ID;

// مخزن مؤقت للوظائف (Jobs)
const jobs = new Map();

// --- وظائف مساعدة ---

// 1. تنظيف اسم الليبل (الحل الجذري للمشكلة)
const sanitizeLabel = (title) => {
  if (!title) return null;
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-') // تحويل المسافات لشرطات
    .replace(/[^a-z0-9-آ-ي]/g, ''); // إبقاء الحروف والأرقام والشرطات فقط (يدعم العربي)
};

const chatwootApi = axios.create({
  baseURL: CHATWOOT_BASE_URL,
  headers: {
    'api_access_token': CHATWOOT_API_TOKEN,
    'Content-Type': 'application/json',
  }
});

// --- معالجة الوظيفة ---
async function runImportJob(jobId, filePath, mapping, options) {
  const job = jobs.get(jobId);
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const rows = csv.parse(fileContent, { columns: true, skip_empty_lines: true });

  job.status = 'running';
  job.stats.total = rows.length;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row[mapping.name] || 'No Name';
    const phone = row[mapping.phone];
    const rawLabel = row[mapping.label];

    // تنظيف اسم الليبل فوراً قبل أي عملية
    const cleanLabel = sanitizeLabel(rawLabel);

    if (!phone || !cleanLabel) {
      job.stats.skipped++;
      continue;
    }

    try {
      // 1. البحث أو إنشاء الكونتاكت
      let contactId;
      const search = await chatwootApi.get(`/api/v1/accounts/${ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(phone)}`);
      
      if (search.data.payload.length > 0) {
        contactId = search.data.payload[0].id;
      } else {
        const create = await chatwootApi.post(`/api/v1/accounts/${ACCOUNT_ID}/contacts`, {
          name,
          phone_number: phone,
          inbox_id: INBOX_ID
        });
        contactId = create.data.payload.contact.id;
        job.stats.createdContacts++;
      }

      // 2. التأكد من وجود الليبل (أو إنشاؤه)
      const labelsRes = await chatwootApi.get(`/api/v1/accounts/${ACCOUNT_ID}/labels`);
      const exists = labelsRes.data.payload.find(l => l.title === cleanLabel);

      if (!exists) {
        await chatwootApi.post(`/api/v1/accounts/${ACCOUNT_ID}/labels`, {
          title: cleanLabel,
          color: '#4f46e5',
          show_on_sidebar: true
        });
        job.stats.labelsCreated++;
      }

      // 3. ربط الليبل بالكونتاكت
      await chatwootApi.post(`/api/v1/accounts/${ACCOUNT_ID}/contacts/${contactId}/labels`, {
        labels: [cleanLabel]
      });

      job.stats.labeled++;
      job.logs.push({ id: Date.now(), type: 'success', message: `تمت معالجة ${name}`, rowNumber: i + 1, time: new Date() });

    } catch (error) {
      job.stats.failed++;
      job.logs.push({ 
        id: Date.now(), 
        type: 'error', 
        message: `فشل السطر ${i + 1}: ${error.response?.data?.message || error.message}`, 
        rowNumber: i + 1, 
        time: new Date() 
      });
    }

    job.stats.processed++;
    await new Promise(r => setTimeout(r, options.delayMs || 300));
  }

  job.status = 'completed';
  fs.unlinkSync(filePath); // مسح الملف بعد الانتهاء
}

// --- Endpoints ---

app.get('/api/config', (req, res) => {
  res.json({
    configured: !!(CHATWOOT_API_TOKEN && ACCOUNT_ID),
    baseUrl: CHATWOOT_BASE_URL,
    accountId: ACCOUNT_ID,
    hasInboxId: !!INBOX_ID,
    requiresPassword: !!process.env.APP_PASSWORD
  });
});

app.post('/api/preview', upload.single('file'), (req, res) => {
  const fileContent = fs.readFileSync(req.file.path, 'utf-8');
  const rows = csv.parse(fileContent, { columns: true, skip_empty_lines: true });
  const columns = Object.keys(rows[0] || {});
  
  res.json({
    columns,
    total: rows.length,
    sample: rows.slice(0, 5),
    suggestedMapping: {
      name: columns.find(c => c.toLowerCase().includes('name')) || '',
      phone: columns.find(c => c.toLowerCase().includes('phone')) || '',
      label: columns.find(c => c.toLowerCase().includes('attribute')) || ''
    }
  });
});

app.post('/api/import-jobs', upload.single('file'), (req, res) => {
  const jobId = Date.now().toString();
  const mapping = JSON.parse(req.body.mapping);
  const options = JSON.parse(req.body.options);

  jobs.set(jobId, {
    id: jobId,
    status: 'queued',
    stats: { total: 0, processed: 0, labeled: 0, createdContacts: 0, labelsCreated: 0, failed: 0, skipped: 0 },
    logs: [],
    failures: []
  });

  runImportJob(jobId, req.file.path, mapping, options);
  res.json({ jobId, job: jobs.get(jobId) });
});

app.get('/api/import-jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ message: 'Job not found' });
  res.json({ job });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
