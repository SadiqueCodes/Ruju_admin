import { useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_PANEL_CONFIG } from './config';
import {
  cleanContent,
  dedupeRows,
  normalizeIncomingRow,
  parseTelegramPost,
  summarizeReport,
  validateRows,
} from './utils/parser';

function kindFromReport(report) {
  if (report.invalidRequired > 0) return 'err';
  if (report.warnings.length > 0) return 'warn';
  return 'ok';
}

function normText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function pickRicherText(a, b) {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x) return y;
  if (!y) return x;
  const xn = normText(x);
  const yn = normText(y);
  if (xn === yn) return x.length >= y.length ? x : y;
  if (xn.includes(yn)) return x;
  if (yn.includes(xn)) return y;
  return x.length >= y.length ? x : y;
}

function appendUniqueTafseer(oldTafseer, newTafseer) {
  const a = String(oldTafseer || '').trim();
  const b = String(newTafseer || '').trim();
  if (!a) return b;
  if (!b) return a;
  const an = normText(a);
  const bn = normText(b);
  if (an === bn) return a.length >= b.length ? a : b;
  if (an.includes(bn)) return a;
  if (bn.includes(an)) return b;
  return `${a}\n\n${b}`.trim();
}

function mergeAyahRow(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    surah_name: incoming.surah_name || existing.surah_name || '',
    juz_number: incoming.juz_number ?? existing.juz_number ?? null,
    arabic_text: pickRicherText(existing.arabic_text, incoming.arabic_text),
    translation: pickRicherText(existing.translation, incoming.translation),
    tafseer: appendUniqueTafseer(existing.tafseer, incoming.tafseer),
    source_post_id: incoming.source_post_id ?? existing.source_post_id ?? null,
  };
}

const NAV_ITEMS = [
  { key: 'bulk', label: 'Bulk Paste' },
  { key: 'json', label: 'JSON Import' },
  { key: 'manual', label: 'Manual Entry' },
  { key: 'history', label: 'History' },
  { key: 'account', label: 'Account' },
];

export default function App() {
  const adminEmails = (ADMIN_PANEL_CONFIG.ADMIN_EMAILS || []).map((x) => String(x || '').trim()).filter(Boolean);

  const [selectedEmail, setSelectedEmail] = useState(adminEmails[0] || '');
  const [password, setPassword] = useState('');
  const [auth, setAuth] = useState({ text: 'Not connected', kind: 'warn' });
  const [supabase, setSupabase] = useState(null);
  const [activePage, setActivePage] = useState('account');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState({});

  const [bulkPostId, setBulkPostId] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [parseReport, setParseReport] = useState(null);
  const [parseStatus, setParseStatus] = useState({ text: 'No parsed rows yet', kind: '' });

  const [jsonRows, setJsonRows] = useState([]);
  const [jsonReport, setJsonReport] = useState(null);
  const [jsonStatus, setJsonStatus] = useState({ text: 'No file selected', kind: '' });

  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState({ text: '', kind: '' });
  const [manualStatus, setManualStatus] = useState({ text: 'Ready', kind: '' });
  const [manual, setManual] = useState({
    surah_number: '',
    surah_name: '',
    juz_number: '',
    ayah_number: '',
    arabic_text: '',
    translation: '',
    tafseer: '',
    source_post_id: '',
  });

  const previewRows = useMemo(() => parsedRows.slice(0, 40), [parsedRows]);
  const isAuthed = !!supabase;

  function isBusy(key) {
    return !!loading[key];
  }

  async function runWithLoading(key, fn) {
    setLoading((p) => ({ ...p, [key]: true }));
    try {
      await fn();
    } finally {
      setLoading((p) => ({ ...p, [key]: false }));
    }
  }

  function ensureSignedIn(setStatus) {
    if (supabase) return true;
    setAuth({ text: 'Sign in first', kind: 'warn' });
    if (setStatus) setStatus({ text: 'Sign in first', kind: 'warn' });
    return false;
  }

  async function connectAndSignIn() {
    const url = ADMIN_PANEL_CONFIG.SUPABASE_URL || '';
    const anon = ADMIN_PANEL_CONFIG.SUPABASE_ANON_KEY || '';
    const email = selectedEmail || '';
    if (!url || !anon || !email || !password) {
      setAuth({ text: 'Set URL/anon and email + password', kind: 'err' });
      return;
    }

    setAuth({ text: 'Connecting...', kind: 'warn' });
    const client = createClient(url, anon, { auth: { persistSession: true } });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      setAuth({ text: `Sign-in failed: ${error.message}`, kind: 'err' });
      return;
    }
    setSupabase(client);
    setAuth({ text: 'Connected', kind: 'ok' });
    setHistoryStatus({ text: '', kind: '' });
    setActivePage('bulk');
    await refreshHistory(client);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSupabase(null);
    setAuth({ text: 'Signed out', kind: 'warn' });
    setActivePage('account');
    setMenuOpen(false);
  }

  async function refreshHistory(client = supabase) {
    if (!client) return;
    const { data, error } = await client
      .from('admin_upload_logs')
      .select('id,created_at,admin_email,admin_user_id,source_type,row_count,summary')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      setHistory([{ id: `err-${Date.now()}`, created_at: new Date().toISOString(), admin_email: '-', source_type: 'error', row_count: 0, summary: error.message }]);
      return;
    }
    setHistory(data || []);
    setHistoryStatus({ text: '', kind: '' });
  }

  async function logUpload(client, sourceType, rowCount, summary) {
    try {
      const user = (await client.auth.getUser())?.data?.user;
      await client.from('admin_upload_logs').insert({
        admin_user_id: user?.id || null,
        admin_email: user?.email || null,
        source_type: sourceType,
        row_count: rowCount,
        summary,
      });
    } catch (_e) {}
  }

  function extractSourcePostIdFromSummary(summary) {
    const match = String(summary || '').match(/source_post_id\s*=\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  async function deleteHistoryEntry(entry) {
    if (!supabase) {
      setHistoryStatus({ text: 'Sign in first', kind: 'warn' });
      return;
    }
    if (!entry?.id) return;
    if (!window.confirm('Delete this history row?')) return;
    const { error } = await supabase.from('admin_upload_logs').delete().eq('id', entry.id);
    if (error) {
      setAuth({ text: `History delete failed: ${error.message}`, kind: 'err' });
      return;
    }
    await refreshHistory();
  }

  async function undoUploadFromHistory(entry) {
    if (!supabase) {
      setHistoryStatus({ text: 'Sign in first', kind: 'warn' });
      return;
    }
    const sourcePostId = extractSourcePostIdFromSummary(entry?.summary);
    if (!sourcePostId) {
      window.alert('Undo needs source_post_id in summary. This row cannot be auto-undo.');
      return;
    }
    if (!window.confirm(`Undo upload for source_post_id=${sourcePostId}? This deletes matching ayahs.`)) return;
    const { error } = await supabase.from('ayahs').delete().eq('source_post_id', sourcePostId);
    if (error) {
      setAuth({ text: `Undo failed: ${error.message}`, kind: 'err' });
      return;
    }
    setAuth({ text: `Undone source_post_id=${sourcePostId}`, kind: 'ok' });
    await refreshHistory();
  }

  async function upsertRows(rows, setStatus, sourceType, options = {}) {
    if (!supabase) {
      setStatus({ text: 'Connect first', kind: 'err' });
      return;
    }
    const normalized = dedupeRows(rows.map(normalizeIncomingRow));
    if (!normalized.length) {
      setStatus({ text: 'No rows to upload', kind: 'warn' });
      return;
    }

    const report = validateRows(normalized);
    if (report.invalidRequired > 0) {
      setStatus({ text: `Blocked: ${report.invalidRequired} invalid row(s)`, kind: 'err' });
      return;
    }

    setStatus({ text: `Preparing ${normalized.length} rows...`, kind: 'warn' });

    const grouped = new Map();
    for (const row of normalized) {
      if (!grouped.has(row.surah_number)) grouped.set(row.surah_number, new Set());
      grouped.get(row.surah_number).add(row.ayah_number);
    }

    const existingMap = new Map();
    for (const [surahNo, ayahSet] of grouped.entries()) {
      const ayahList = Array.from(ayahSet);
      const { data, error: fetchError } = await supabase
        .from('ayahs')
        .select('surah_number,surah_name,juz_number,ayah_number,arabic_text,translation,tafseer,source_post_id')
        .eq('surah_number', surahNo)
        .in('ayah_number', ayahList);
      if (fetchError) {
        setStatus({ text: `Fetch existing failed: ${fetchError.message}`, kind: 'err' });
        return;
      }
      for (const row of data || []) existingMap.set(`${row.surah_number}:${row.ayah_number}`, row);
    }

    const mergedRows = normalized.map((incoming) => mergeAyahRow(existingMap.get(`${incoming.surah_number}:${incoming.ayah_number}`), incoming));
    setStatus({ text: `Uploading ${mergedRows.length} merged rows...`, kind: 'warn' });

    const { error } = await supabase.from('ayahs').upsert(mergedRows, { onConflict: 'surah_number,ayah_number' });
    if (error) {
      setStatus({ text: `Upsert failed: ${error.message}`, kind: 'err' });
      return;
    }

    const sourcePostId = Number(options?.sourcePostId) || null;
    const summary = sourcePostId ? `${summarizeReport(report)} | source_post_id=${sourcePostId}` : summarizeReport(report);
    await logUpload(supabase, sourceType, normalized.length, summary);
    await refreshHistory();
    setStatus({ text: `Upserted ${normalized.length} rows`, kind: 'ok' });
  }

  function parseBulk() {
    try {
      const sourcePostId = Number(bulkPostId) || null;
      const rows = parseTelegramPost(bulkInput, sourcePostId);
      const report = validateRows(rows);
      setParsedRows(rows);
      setParseReport(report);
      setParseStatus({ text: `Parsed ${rows.length} rows`, kind: kindFromReport(report) });
    } catch (e) {
      setParsedRows([]);
      setParseReport(null);
      setParseStatus({ text: e.message || 'Parse failed', kind: 'err' });
    }
  }

  async function validateJsonFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : Array.isArray(parsed?.ayahs) ? parsed.ayahs : null;
      if (!raw) throw new Error('JSON must be array, or {rows:[...]}, or {ayahs:[...]}');
      const rows = dedupeRows(raw.map(normalizeIncomingRow));
      const report = validateRows(rows);
      setJsonRows(rows);
      setJsonReport(report);
      setJsonStatus({ text: `Validated ${rows.length} rows`, kind: kindFromReport(report) });
    } catch (e) {
      setJsonRows([]);
      setJsonReport(null);
      setJsonStatus({ text: e.message || 'Invalid JSON', kind: 'err' });
    }
  }

  function accountContent() {
    return (
      <>
        <div className="head"><h2>Account</h2></div>
        <p className="sub">{isAuthed ? 'Supabase connection and authentication.' : 'Sign in to open Bulk/JSON/Manual/History pages.'}</p>
        <div className="grid g2">
          <label className="field">
            <span>Supabase URL</span>
            <input value={ADMIN_PANEL_CONFIG.SUPABASE_URL || ''} readOnly />
          </label>
          <label className="field">
            <span>Admin Email</span>
            <select value={selectedEmail} onChange={(e) => setSelectedEmail(e.target.value)}>
              {adminEmails.length ? adminEmails.map((email) => <option key={email} value={email}>{email}</option>) : <option value="">No emails in config</option>}
            </select>
          </label>
        </div>
        <div className="row">
          <input type="password" placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn gold" disabled={isBusy('connect')} onClick={() => runWithLoading('connect', connectAndSignIn)}>
            {isBusy('connect') ? 'Connecting...' : 'Connect & Sign In'}
          </button>
          {isAuthed ? (
            <>
              <button className="btn ghost" disabled={isBusy('signout')} onClick={() => runWithLoading('signout', signOut)}>
                {isBusy('signout') ? 'Signing out...' : 'Sign Out'}
              </button>
              <button className="btn ghost" disabled={isBusy('history_boot')} onClick={() => runWithLoading('history_boot', () => refreshHistory())}>
                {isBusy('history_boot') ? 'Loading...' : 'Load History'}
              </button>
            </>
          ) : null}
        </div>
      </>
    );
  }

  function pageContent() {
    if (activePage === 'bulk') {
      return (
        <>
          <div className="head"><h2>Bulk Telegram Paste</h2><span className={`pill ${parseStatus.kind}`}>{parseStatus.text}</span></div>
          <p className="sub">Paste full Telegram post and upsert merged ayahs.</p>
          <div className="grid g2">
            <label className="field">
              <span>Source Post ID</span>
              <input value={bulkPostId} onChange={(e) => setBulkPostId(e.target.value)} placeholder="optional" />
            </label>
          </div>
          <label className="field">
            <span>Telegram Text</span>
            <textarea rows={12} value={bulkInput} onChange={(e) => setBulkInput(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn" disabled={isBusy('bulk_parse')} onClick={() => runWithLoading('bulk_parse', async () => parseBulk())}>
              {isBusy('bulk_parse') ? 'Parsing...' : 'Parse'}
            </button>
            <button
              className="btn gold"
              disabled={isBusy('bulk_upsert')}
              onClick={() => {
                if (!ensureSignedIn(setParseStatus)) return;
                runWithLoading('bulk_upsert', () => upsertRows(parsedRows, setParseStatus, 'bulk_telegram', { sourcePostId: Number(bulkPostId) || null }));
              }}
            >
              {isBusy('bulk_upsert') ? 'Uploading...' : 'Upsert Parsed Ayahs'}
            </button>
          </div>
          {parseReport ? <div className={`quality ${kindFromReport(parseReport)}`}>{summarizeReport(parseReport)}{parseReport.warnings.length ? ` | ${parseReport.warnings.join(' | ')}` : ''}</div> : null}
          <div className="tableWrap">
            <table>
              <thead><tr><th>Surah</th><th>Name</th><th>Juz</th><th>Ayah</th><th>Arabic</th><th>Translation</th><th>Tafseer</th></tr></thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={`${row.surah_number}:${row.ayah_number}`}>
                    <td>{row.surah_number}</td>
                    <td>{row.surah_name}</td>
                    <td>{row.juz_number ?? '-'}</td>
                    <td>{row.ayah_number}</td>
                    <td className="cell-content">{cleanContent(row.arabic_text)}</td>
                    <td className="cell-content">{cleanContent(row.translation)}</td>
                    <td className="cell-content">{cleanContent(row.tafseer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    if (activePage === 'json') {
      return (
        <>
          <div className="head"><h2>JSON Import</h2><span className={`pill ${jsonStatus.kind}`}>{jsonStatus.text}</span></div>
          <p className="sub">Import full ayah JSON and upsert with merge logic.</p>
          <div className="row">
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => e.target.files?.[0] && runWithLoading('json_validate', () => validateJsonFile(e.target.files[0]))}
            />
            <button
              className="btn gold"
              disabled={isBusy('json_upsert')}
              onClick={() => {
                if (!ensureSignedIn(setJsonStatus)) return;
                runWithLoading('json_upsert', () => upsertRows(jsonRows, setJsonStatus, 'json_import', {}));
              }}
            >
              {isBusy('json_upsert') ? 'Importing...' : 'Import JSON'}
            </button>
          </div>
          {jsonReport ? <div className={`quality ${kindFromReport(jsonReport)}`}>{summarizeReport(jsonReport)}{jsonReport.warnings.length ? ` | ${jsonReport.warnings.join(' | ')}` : ''}</div> : null}
        </>
      );
    }

    if (activePage === 'manual') {
      return (
        <>
          <div className="head"><h2>Manual Entry</h2><span className={`pill ${manualStatus.kind}`}>{manualStatus.text}</span></div>
          <div className="grid g4">
            <label className="field"><span>Surah #</span><input value={manual.surah_number} onChange={(e) => setManual((p) => ({ ...p, surah_number: e.target.value }))} /></label>
            <label className="field"><span>Surah Name</span><input value={manual.surah_name} onChange={(e) => setManual((p) => ({ ...p, surah_name: e.target.value }))} /></label>
            <label className="field"><span>Juz #</span><input value={manual.juz_number} onChange={(e) => setManual((p) => ({ ...p, juz_number: e.target.value }))} /></label>
            <label className="field"><span>Ayah #</span><input value={manual.ayah_number} onChange={(e) => setManual((p) => ({ ...p, ayah_number: e.target.value }))} /></label>
          </div>
          <label className="field"><span>Arabic</span><textarea rows={3} value={manual.arabic_text} onChange={(e) => setManual((p) => ({ ...p, arabic_text: e.target.value }))} /></label>
          <label className="field"><span>Translation</span><textarea rows={3} value={manual.translation} onChange={(e) => setManual((p) => ({ ...p, translation: e.target.value }))} /></label>
          <label className="field"><span>Tafseer</span><textarea rows={4} value={manual.tafseer} onChange={(e) => setManual((p) => ({ ...p, tafseer: e.target.value }))} /></label>
          <div className="row">
            <label className="field" style={{ minWidth: 240 }}>
              <span>Source Post ID</span>
              <input value={manual.source_post_id} onChange={(e) => setManual((p) => ({ ...p, source_post_id: e.target.value }))} />
            </label>
            <button
              className="btn gold"
              disabled={isBusy('manual_upsert')}
              onClick={() =>
                ensureSignedIn(setManualStatus) &&
                runWithLoading('manual_upsert', () =>
                  upsertRows(
                    [normalizeIncomingRow({
                      surah_number: Number(manual.surah_number),
                      surah_name: manual.surah_name,
                      juz_number: manual.juz_number ? Number(manual.juz_number) : null,
                      ayah_number: Number(manual.ayah_number),
                      arabic_text: manual.arabic_text,
                      translation: manual.translation,
                      tafseer: manual.tafseer,
                      source_post_id: manual.source_post_id ? Number(manual.source_post_id) : null,
                    })],
                    setManualStatus,
                    'manual_entry',
                    { sourcePostId: manual.source_post_id ? Number(manual.source_post_id) : null }
                  )
                )
              }
            >
              {isBusy('manual_upsert') ? 'Saving...' : 'Upsert Manual Ayah'}
            </button>
          </div>
        </>
      );
    }

    if (activePage === 'history') {
      return (
        <>
          <div className="head">
            <h2>Upload History</h2>
            <div className="row mini">
              {historyStatus.text ? <span className={`pill ${historyStatus.kind}`}>{historyStatus.text}</span> : null}
              <button
                className="btn ghost"
                disabled={isBusy('history_refresh')}
                onClick={() => {
                  if (!ensureSignedIn(setHistoryStatus)) return;
                  runWithLoading('history_refresh', () => refreshHistory());
                }}
              >
                {isBusy('history_refresh') ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
          <div className="tableWrap">
            <table>
              <thead><tr><th>Time</th><th>Admin</th><th>Source</th><th>Rows</th><th>Summary</th><th>Action</th></tr></thead>
              <tbody>
                {history.map((h, i) => {
                  const undoKey = `undo_${h.id || i}`;
                  const delKey = `del_${h.id || i}`;
                  return (
                    <tr key={h.id ? `h-${h.id}` : `${h.created_at}-${i}`}>
                      <td>{new Date(h.created_at).toLocaleString()}</td>
                      <td>{h.admin_email || h.admin_user_id || '-'}</td>
                      <td>{h.source_type || '-'}</td>
                      <td>{h.row_count || 0}</td>
                      <td>{h.summary || '-'}</td>
                      <td>
                        <div className="row mini">
                          <button className="btn ghost" disabled={isBusy(undoKey)} onClick={() => runWithLoading(undoKey, () => undoUploadFromHistory(h))}>
                            {isBusy(undoKey) ? 'Undoing...' : 'Undo Data'}
                          </button>
                          <button className="btn ghost" disabled={isBusy(delKey)} onClick={() => runWithLoading(delKey, () => deleteHistoryEntry(h))}>
                            {isBusy(delKey) ? 'Deleting...' : 'Delete Log'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    return accountContent();
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">Ruju Admin</div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`navItem ${activePage === item.key ? 'active' : ''}`}
            onClick={() => {
              setActivePage(item.key);
              setMenuOpen(false);
            }}
          >
            {item.label}
          </button>
        ))}
      </aside>

      {menuOpen ? <div className="overlay" onClick={() => setMenuOpen(false)} /> : null}

      <main className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setMenuOpen((v) => !v)}>&#9776;</button>
          <div className="topMeta">
            <h1>{NAV_ITEMS.find((x) => x.key === activePage)?.label || 'Admin'}</h1>
            <span className={`pill ${auth.kind}`}>{auth.text}</span>
          </div>
        </header>

        <section className="panel">{pageContent()}</section>
      </main>
    </div>
  );
}
