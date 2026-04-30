import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Tag,
  Upload,
  Users,
  XCircle,
} from 'lucide-react';

const LOG_LABELS = {
  success: 'نجاح',
  error: 'خطأ',
  warning: 'تنبيه',
  info: 'معلومة',
};

function apiHeaders(password) {
  return password ? { 'x-app-password': password } : {};
}

async function parseApiResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'حدث خطأ غير متوقع.');
  }
  return data;
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function StatBox({ icon: Icon, label, value, tone = 'slate' }) {
  return (
    <div className={`stat stat-${tone}`}>
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [password, setPassword] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({ name: '', phone: '', label: '' });
  const [options, setOptions] = useState({
    createMissingContacts: true,
    skipDuplicateRows: true,
    delayMs: 350,
  });
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const isRunning = job?.status === 'queued' || job?.status === 'running';
  const progress = job?.stats?.total ? Math.round((job.stats.processed / job.stats.total) * 100) : 0;
  const requiresPassword = Boolean(config?.requiresPassword);
  const canStart = Boolean(file && preview && mapping.phone && mapping.label && !isRunning);

  const loadConfig = useCallback(async () => {
    const response = await fetch('/api/config');
    const data = await parseApiResponse(response);
    setConfig(data);
    setOptions(prev => ({ ...prev, delayMs: data.requestDelayMs || prev.delayMs }));
  }, []);

  useEffect(() => {
    loadConfig().catch(err => setError(err.message));
  }, [loadConfig]);

  useEffect(() => {
    if (!jobId || !isRunning) return undefined;

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/import-jobs/${jobId}`, {
          headers: apiHeaders(password),
        });
        const data = await parseApiResponse(response);
        setJob(data.job);
      } catch (err) {
        setError(err.message);
      }
    }, 1400);

    return () => window.clearInterval(timer);
  }, [isRunning, jobId, password]);

  async function previewFile(nextFile) {
    setError('');
    setPreview(null);
    setJob(null);
    setJobId(null);
    if (!nextFile) return;

    setIsPreviewing(true);
    const formData = new FormData();
    formData.append('file', nextFile);

    try {
      const response = await fetch('/api/preview', {
        method: 'POST',
        headers: apiHeaders(password),
        body: formData,
      });
      const data = await parseApiResponse(response);
      setPreview(data);
      setMapping(data.suggestedMapping);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsPreviewing(false);
    }
  }

  function handleFileChange(event) {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    previewFile(nextFile);
  }

  async function startImport() {
    if (!canStart) return;

    setError('');
    setIsStarting(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mapping', JSON.stringify(mapping));
    formData.append('options', JSON.stringify(options));

    try {
      const response = await fetch('/api/import-jobs', {
        method: 'POST',
        headers: apiHeaders(password),
        body: formData,
      });
      const data = await parseApiResponse(response);
      setJob(data.job);
      setJobId(data.jobId);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsStarting(false);
    }
  }

  const columns = preview?.columns || [];
  const sampleRows = preview?.sample || [];
  const statusText = useMemo(() => {
    if (!job) return 'جاهز';
    if (job.status === 'running') return 'يتم التنفيذ';
    if (job.status === 'completed') return 'اكتمل';
    if (job.status === 'completed_with_errors') return 'اكتمل مع أخطاء';
    if (job.status === 'failed') return 'فشل';
    return 'في الانتظار';
  }, [job]);

  return (
    <main className="app-shell" dir="rtl">
      <section className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <FileSpreadsheet size={24} />
          </div>
          <div>
            <h1>Chatwoot Smart Importer</h1>
            <p>ارفع CSV أو Excel، أنشئ الكونتاكت، أنشئ الليبل، واربطهم بدون تكرار.</p>
          </div>
        </div>
        <div className="connection-pill">
          <Server size={16} />
          <span>{config?.baseUrl || 'Chatwoot'}</span>
        </div>
      </section>

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {!config?.configured && (
        <div className="alert alert-warning">
          <Settings size={18} />
          <span>إعدادات Chatwoot ناقصة على السيرفر. راجع Environment Variables في Coolify.</span>
        </div>
      )}

      {config?.configured && !config?.hasInboxId && (
        <div className="alert alert-warning">
          <AlertCircle size={18} />
          <span>لإنشاء Contacts جديدة لازم تضيف CHATWOOT_INBOX_ID. بدونها الأداة تقدر تربط الموجود فقط.</span>
        </div>
      )}

      <div className="layout">
        <aside className="panel settings-panel">
          <div className="panel-title">
            <Settings size={18} />
            <h2>الإعدادات</h2>
          </div>

          {requiresPassword && (
            <label className="field">
              <span>
                <KeyRound size={14} />
                كلمة مرور الأداة
              </span>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="APP_PASSWORD"
              />
            </label>
          )}

          <div className="config-grid">
            <div>
              <span>Account ID</span>
              <strong>{config?.accountId || '-'}</strong>
            </div>
            <div>
              <span>Default Country</span>
              <strong>{config?.defaultCountryCode ? `+${config.defaultCountryCode}` : '-'}</strong>
            </div>
          </div>

          <div className="panel-title compact">
            <Tag size={18} />
            <h2>تطابق الأعمدة</h2>
          </div>

          {[
            { key: 'name', label: 'اسم العميل', required: false },
            { key: 'phone', label: 'رقم الهاتف', required: true },
            { key: 'label', label: 'اسم الليبل', required: true },
          ].map(item => (
            <label className="field" key={item.key}>
              <span>
                {item.label}
                {item.required ? <b>*</b> : null}
              </span>
              <select
                value={mapping[item.key]}
                onChange={event => setMapping(prev => ({ ...prev, [item.key]: event.target.value }))}
                disabled={!columns.length}
              >
                <option value="">اختر العمود</option>
                {columns.map(column => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <div className="panel-title compact">
            <ShieldCheck size={18} />
            <h2>خيارات التنفيذ</h2>
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={options.createMissingContacts}
              onChange={event => setOptions(prev => ({ ...prev, createMissingContacts: event.target.checked }))}
            />
            <span>إنشاء الكونتاكت لو الرقم غير موجود</span>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={options.skipDuplicateRows}
              onChange={event => setOptions(prev => ({ ...prev, skipDuplicateRows: event.target.checked }))}
            />
            <span>تخطي الصفوف المكررة في نفس الملف</span>
          </label>

          <label className="field">
            <span>
              <Clock size={14} />
              Delay بين الطلبات
            </span>
            <input
              type="number"
              min="0"
              step="50"
              value={options.delayMs}
              onChange={event => setOptions(prev => ({ ...prev, delayMs: Number(event.target.value) }))}
            />
          </label>
        </aside>

        <section className="workspace">
          <div className="panel upload-panel">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFileChange}
              className="hidden-input"
            />

            <button className="dropzone" type="button" onClick={() => fileInputRef.current?.click()} disabled={isRunning}>
              {isPreviewing ? <Loader2 className="spin" size={28} /> : <Upload size={28} />}
              <strong>{file ? file.name : 'ارفع ملف CSV أو Excel'}</strong>
              <span>{preview ? `${preview.total} صف جاهز للمعاينة` : 'الأعمدة المتوقعة: name / phone_number / custom_attribute_1'}</span>
            </button>

            <div className="actions-row">
              <button className="primary-button" type="button" onClick={startImport} disabled={!canStart || isStarting}>
                {isStarting || isRunning ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                بدء الاستيراد
              </button>
              <button className="ghost-button" type="button" onClick={() => file && previewFile(file)} disabled={!file || isRunning}>
                <RefreshCw size={18} />
                إعادة قراءة الملف
              </button>
            </div>
          </div>

          {preview && (
            <div className="panel sample-panel">
              <div className="panel-title">
                <FileSpreadsheet size={18} />
                <h2>معاينة أول الصفوف</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {columns.slice(0, 6).map(column => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sampleRows.map((row, index) => (
                      <tr key={`${index}-${row[mapping.phone] || ''}`}>
                        {columns.slice(0, 6).map(column => (
                          <td key={column}>{row[column]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="panel progress-panel">
            <div className="status-line">
              <div>
                <span>حالة العملية</span>
                <strong>{statusText}</strong>
              </div>
              <div className="progress-number">{progress}%</div>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>

            <div className="stats-grid">
              <StatBox icon={Users} label="الصفوف" value={job?.stats?.total || preview?.total || 0} />
              <StatBox icon={CheckCircle2} label="تم الربط" value={job?.stats?.labeled || 0} tone="green" />
              <StatBox icon={Users} label="جديدة" value={job?.stats?.createdContacts || 0} tone="teal" />
              <StatBox icon={Tag} label="ليبلز جديدة" value={job?.stats?.labelsCreated || 0} tone="blue" />
              <StatBox icon={AlertCircle} label="فشل" value={job?.stats?.failed || 0} tone="red" />
              <StatBox icon={XCircle} label="تخطي" value={(job?.stats?.skipped || 0) + (job?.stats?.duplicateRows || 0)} tone="amber" />
            </div>

            {job?.failures?.length > 0 && (
              <a className="download-link" href={`/api/import-jobs/${job.id}/failures.csv`} target="_blank" rel="noreferrer">
                <Download size={16} />
                تحميل ملف الأخطاء
              </a>
            )}
          </div>

          <div className="panel logs-panel">
            <div className="panel-title">
              <Clock size={18} />
              <h2>سجل التنفيذ</h2>
            </div>
            <div className="logs">
              {!job?.logs?.length ? (
                <div className="empty-log">بانتظار رفع الملف وبدء الاستيراد.</div>
              ) : (
                job.logs.map(log => (
                  <div className={`log-row log-${log.type}`} key={log.id}>
                    <span>{formatTime(log.time)}</span>
                    <b>{LOG_LABELS[log.type] || log.type}</b>
                    <p>{log.rowNumber ? `سطر ${log.rowNumber}: ` : ''}{log.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
