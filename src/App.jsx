import { useMemo, useState, useEffect } from 'react';
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

const FRAME_ASSETS = import.meta.glob('./frames/*.{jpg,jpeg,png,webp}', {
  eager: true,
  import: 'default',
});

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
  { key: 'post', label: 'Create Post' },
  { key: 'posts', label: 'My Posts' },
  { key: 'surah_name', label: 'Change Surah Name' },
  { key: 'history', label: 'History' },
  { key: 'account', label: 'Account' },
];

const POST_STYLES = [
  { key: 'serif', label: 'Serif', textStyle: { fontSize: 20, lineHeight: 28, fontFamily: 'Georgia, Times New Roman, serif' } },
  { key: 'mono', label: 'Mono', textStyle: { fontSize: 20, lineHeight: 27, fontFamily: 'Consolas, Courier New, monospace' } },
  { key: 'quote', label: 'Quote', textStyle: { fontSize: 21, lineHeight: 30, fontWeight: '600', fontStyle: 'italic', fontFamily: 'Georgia, Times New Roman, serif' } },
  { key: 'classic', label: 'Classic', textStyle: { fontSize: 20, lineHeight: 28, fontWeight: '700', fontFamily: 'Georgia, Times New Roman, serif' } },
  { key: 'cursive', label: 'Cursive', textStyle: { fontSize: 22, lineHeight: 30, fontStyle: 'italic', fontFamily: 'Segoe Script, Brush Script MT, cursive' } },
  { key: 'poster', label: 'Poster', textStyle: { fontSize: 24, lineHeight: 30, fontWeight: '900', letterSpacing: 0.4, fontFamily: 'Segoe UI, sans-serif' } },
  { key: 'airy', label: 'Airy', textStyle: { fontSize: 18, lineHeight: 29, fontWeight: '500', letterSpacing: 0.9, fontFamily: 'Trebuchet MS, Segoe UI, sans-serif' } },
  { key: 'neon', label: 'Neon', textStyle: { fontSize: 20, lineHeight: 28, fontWeight: '800', letterSpacing: 1.2, fontFamily: 'Segoe UI, sans-serif' } },
  { key: 'caps', label: 'Caps', textStyle: { fontSize: 18, lineHeight: 25, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: 'Trebuchet MS, Segoe UI, sans-serif' } },
  { key: 'minimal', label: 'Minimal', textStyle: { fontSize: 17, lineHeight: 24, fontWeight: '400', fontFamily: 'Segoe UI, sans-serif' } },
];

const FRAME_OPTIONS = [
  { key: 'plain', label: 'Plain', assetFile: null },
  { key: 'frame001', label: 'F1', assetFile: 'f1.jpg' },
  { key: 'frame003', label: 'F2', assetFile: 'f2.jpg' },
  { key: 'frame004', label: 'F3', assetFile: 'f3.jpg' },
  { key: 'frame005', label: 'F4', assetFile: 'f4.jpg' },
  { key: 'frame006', label: 'F5', assetFile: 'f5.jpg' },
  { key: 'frame008', label: 'F6', assetFile: 'f6.jpg' },
  { key: 'frame010', label: 'F7', assetFile: 'f7.jpg' },
  { key: 'frame011', label: 'F8', assetFile: 'f8.jpg' },
  { key: 'frame012', label: 'F9', assetFile: 'f9.jpg' },
  { key: 'frame013', label: 'F10', assetFile: 'f10.jpg' },
  { key: 'frame014', label: 'F11', assetFile: 'f11.jpg' },
  { key: 'frame015', label: 'F12', assetFile: 'f12.jpg' },
  { key: 'frame016', label: 'F13', assetFile: 'f13.jpg' },
  { key: 'frame017', label: 'F14', assetFile: 'f14.jpg' },
  { key: 'frame020', label: 'F15', assetFile: 'f15.jpg' },
  { key: 'frame021', label: 'F16', assetFile: 'f16.jpg' },
  { key: 'frame022', label: 'F17', assetFile: 'f17.jpg' },
  { key: 'frame023', label: 'F18', assetFile: 'f18.jpg' },
  { key: 'frame024', label: 'F19', assetFile: 'f19.jpg' },
  { key: 'frame025', label: 'F20', assetFile: 'f20.jpg' },
  { key: 'frame026', label: 'F21', assetFile: 'f21.jpg' },
  { key: 'frame027', label: 'F22', assetFile: 'f22.jpg' },
  { key: 'frame029', label: 'F23', assetFile: 'f23.jpg' },
  { key: 'frame030', label: 'F24', assetFile: 'f24.jpg' },
  { key: 'frame031', label: 'F25', assetFile: 'f25.jpg' },
  { key: 'frame033', label: 'F26', assetFile: 'f26.jpg' },
  { key: 'frame035', label: 'F27', assetFile: 'f27.jpg' },
];

const POST_TEXT_SCALE_MIN = 0.45;
const POST_TEXT_SCALE_MAX = 1.6;

const TEXT_COLOR_PRESETS = [
  { value: '#111111', label: 'Classic Ink' },
  { value: '#364152', label: 'Soft Slate' },
  { value: '#4B5563', label: 'Soft Graphite' },
  { value: '#6B4F3A', label: 'Soft Cocoa' },
  { value: '#7C5A7D', label: 'Soft Plum' },
  { value: '#2F5F73', label: 'Soft Teal' },
  { value: '#0F3D2E', label: 'Premium Emerald' },
  { value: '#133C55', label: 'Premium Sapphire' },
  { value: '#3E2A1F', label: 'Premium Espresso' },
  { value: '#5A1321', label: 'Premium Burgundy' },
  { value: '#7A5C12', label: 'Premium Gold' },
  { value: '#102A43', label: 'Premium Midnight' },
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
  const [bulkSurahName, setBulkSurahName] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [parseReport, setParseReport] = useState(null);
  const [parseStatus, setParseStatus] = useState({ text: 'No parsed rows yet', kind: '' });

  const [jsonRows, setJsonRows] = useState([]);
  const [jsonReport, setJsonReport] = useState(null);
  const [jsonStatus, setJsonStatus] = useState({ text: 'No file selected', kind: '' });

  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState({ text: '', kind: '' });
  const [feedPosts, setFeedPosts] = useState([]);
  const [feedStatus, setFeedStatus] = useState({ text: '', kind: '' });
  const [manualStatus, setManualStatus] = useState({ text: 'Ready', kind: '' });
  const [postStatus, setPostStatus] = useState({ text: 'Ready', kind: '' });
  const [renameStatus, setRenameStatus] = useState({ text: 'Ready', kind: '' });
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
  const [postForm, setPostForm] = useState({
    author_name: 'Admin',
    content: '',
    styleKey: 'serif',
    frameKey: 'plain',
    textScale: 0.7,
    textColor: '#111111',
  });
  const [renameForm, setRenameForm] = useState({
    surah_number: '',
    surah_name: '',
  });

  const previewRows = useMemo(() => parsedRows.slice(0, 40), [parsedRows]);
  const [editIndex, setEditIndex] = useState(null);
  const [editSurahName, setEditSurahName] = useState('');

  function startEditRow(idx) {
    setEditIndex(idx);
    setEditSurahName(parsedRows[idx]?.surah_name || '');
  }

  function saveEditRow(idx) {
    setParsedRows((rows) => {
      const updated = [...rows];
      updated[idx] = { ...updated[idx], surah_name: editSurahName };
      return updated;
    });
    setEditIndex(null);
    setEditSurahName('');
  }

  function cancelEditRow() {
    setEditIndex(null);
    setEditSurahName('');
  }
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
    setActivePage('post');
    await refreshHistory(client);
    await refreshFeedPosts(client);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSupabase(null);
    setAuth({ text: 'Signed out', kind: 'warn' });
    setFeedPosts([]);
    setFeedStatus({ text: '', kind: '' });
    setActivePage('account');
    setMenuOpen(false);
  }

  async function refreshFeedPosts(client = supabase) {
    if (!client) return;
    const { data, error } = await client
      .from('feed_posts')
      .select('id,created_at,author_name,content')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      setFeedStatus({ text: `Load failed: ${error.message}`, kind: 'err' });
      return;
    }

    setFeedPosts(data || []);
    setFeedStatus({ text: `Loaded ${(data || []).length} posts`, kind: 'ok' });
  }

  async function deleteFeedPost(post) {
    if (!supabase) {
      setFeedStatus({ text: 'Sign in first', kind: 'warn' });
      return;
    }
    if (!post?.id) return;
    if (!window.confirm('Delete this post from app feed?')) return;

    const { error } = await supabase.from('feed_posts').delete().eq('id', post.id);
    if (error) {
      setFeedStatus({ text: `Delete failed: ${error.message}`, kind: 'err' });
      return;
    }

    setFeedPosts((prev) => prev.filter((x) => x.id !== post.id));
    setFeedStatus({ text: `Deleted post #${post.id}`, kind: 'ok' });
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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeHexColor(value) {
    const cleaned = String(value || '').trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(cleaned)) return '#111111';
    return cleaned.length === 4
      ? `#${cleaned[1]}${cleaned[1]}${cleaned[2]}${cleaned[2]}${cleaned[3]}${cleaned[3]}`.toUpperCase()
      : cleaned.toUpperCase();
  }

  function cleanPostText(text) {
    return String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function getPostMarker() {
    const frameKey = postForm.frameKey || 'plain';
    const styleKey = postForm.styleKey || 'serif';
    const color = normalizeHexColor(postForm.textColor);
    const scale = clamp(Number(postForm.textScale) || 1, POST_TEXT_SCALE_MIN, POST_TEXT_SCALE_MAX);
    return `[[post:style=${styleKey};frame=${frameKey};color=${color};scale=${scale.toFixed(2)}]]`;
  }

  function buildPostContent() {
    const body = cleanPostText(postForm.content);
    return body ? `${getPostMarker()}\n${body}` : '';
  }

  function getStyleLabel(styleKey) {
    return POST_STYLES.find((item) => item.key === styleKey)?.label || 'Serif';
  }

  function getStyle(styleKey) {
    return POST_STYLES.find((item) => item.key === styleKey) || POST_STYLES[0];
  }

  function getFrameLabel(frameKey) {
    return FRAME_OPTIONS.find((item) => item.key === frameKey)?.label || 'Plain';
  }

  function getFrame(frameKey) {
    const raw = String(frameKey || '').toLowerCase().trim();
    const legacy = raw.match(/^frame(\d{1,2})$/);
    const normalizedKey = legacy ? `frame${String(Number(legacy[1])).padStart(3, '0')}` : raw;
    const frame = FRAME_OPTIONS.find((item) => item.key === normalizedKey) || FRAME_OPTIONS[0];
    const source = frame.assetFile ? FRAME_ASSETS[`./frames/${frame.assetFile}`] || null : null;
    return { ...frame, source };
  }

  function getFrameTextLayout(frameKey) {
    const key = String(frameKey || 'plain').toLowerCase();
    const numeric = key.match(/^frame(\d{1,3})$/);
    const frameNum = numeric ? Number(numeric[1]) : 0;
    if (key === 'plain') {
      return { widthPct: 90, heightPct: 90, padH: 26, padV: 26, circle: false, maxLines: 18 };
    }
    if ([10, 11, 12, 26, 27, 29].includes(frameNum)) {
      return { widthPct: 74, heightPct: 74, padH: 12, padV: 12, circle: true, maxLines: 12 };
    }
    if ([7, 8, 9, 18, 19, 20, 21].includes(frameNum)) {
      return { widthPct: 82, heightPct: 82, padH: 18, padV: 18, circle: false, maxLines: 14 };
    }
    return { widthPct: 86, heightPct: 86, padH: 22, padV: 22, circle: false, maxLines: 16 };
  }

  function buildTextStyle(baseStyle, text, userScale, textColor) {
    const len = String(text || '').trim().length;
    const penalty = clamp((len - 120) / 260, 0, 1);
    const autoScale = 1 - penalty * 0.28;
    const mergedScale = clamp((Number(userScale) || 1) * autoScale, 0.36, 1.6);
    const baseFont = baseStyle?.fontSize || 20;
    const baseLine = baseStyle?.lineHeight || Math.round(baseFont * 1.35);
    const baseLetterSpacing = baseStyle?.letterSpacing || 0;
    return {
      ...baseStyle,
      color: normalizeHexColor(textColor),
      fontSize: Math.round(baseFont * mergedScale),
      lineHeight: Math.round(baseLine * mergedScale),
      letterSpacing: baseLetterSpacing ? Number((baseLetterSpacing * mergedScale).toFixed(2)) : 0,
    };
  }

  function getPreviewFontClass(styleKey) {
    const key = String(styleKey || 'serif');
    if (key === 'mono') return 'fontMono';
    if (key === 'quote' || key === 'classic') return 'fontSerif';
    if (key === 'cursive') return 'fontCursive';
    if (key === 'airy') return 'fontWide';
    if (key === 'poster' || key === 'neon' || key === 'caps') return 'fontSystem';
    if (key === 'minimal') return 'fontMinimal';
    return 'fontSerif';
  }

  function getFontPreviewStyle(styleKey) {
    const preset = getStyle(styleKey);
    return {
      fontFamily: preset?.textStyle?.fontFamily || 'inherit',
      fontStyle: preset?.textStyle?.fontStyle || 'normal',
      fontWeight: preset?.textStyle?.fontWeight || '600',
      letterSpacing: preset?.textStyle?.letterSpacing || 'normal',
      textTransform: preset?.textStyle?.textTransform || 'none',
    };
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

  async function upsertSurahNames(rows) {
    const bySurah = new Map();
    for (const row of rows || []) {
      if (!Number.isInteger(row?.surah_number)) continue;
      const name = cleanContent(row.surah_name || '');
      if (!name) continue;
      bySurah.set(row.surah_number, { surah_number: row.surah_number, surah_name: name });
    }

    const surahRows = Array.from(bySurah.values());
    if (!surahRows.length) return { error: null, count: 0 };

    const { error } = await supabase.from('surahs').upsert(surahRows, { onConflict: 'surah_number' });
    return { error, count: surahRows.length };
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

    const { error: surahError } = await upsertSurahNames(mergedRows);
    if (surahError) {
      setStatus({ text: `Ayahs uploaded but surahs update failed: ${surahError.message}`, kind: 'warn' });
    }

    const sourcePostId = Number(options?.sourcePostId) || null;
    const summary = sourcePostId ? `${summarizeReport(report)} | source_post_id=${sourcePostId}` : summarizeReport(report);
    await logUpload(supabase, sourceType, normalized.length, summary);
    await refreshHistory();
    setStatus({ text: `Upserted ${normalized.length} rows`, kind: 'ok' });
  }

  async function createFeedPost() {
    if (!ensureSignedIn(setPostStatus)) return;
    const author = cleanContent(postForm.author_name || 'Admin');
    const body = cleanPostText(postForm.content);
    if (!body) {
      setPostStatus({ text: 'Post text is required', kind: 'err' });
      return;
    }

    const content = buildPostContent();
    const payload = {
      author_name: author || 'Admin',
      content,
      author_device_id: null,
    };

    const { error } = await supabase.from('feed_posts').insert(payload);
    if (error) {
      setPostStatus({ text: `Create post failed: ${error.message}`, kind: 'err' });
      return;
    }

    setPostStatus({ text: 'Post created and sent to app feed', kind: 'ok' });
    setPostForm((p) => ({ ...p, content: '' }));
    await logUpload(supabase, 'admin_feed_post', 1, `author=${author}, style=${postForm.styleKey}, frame=${postForm.frameKey}`);
    await refreshHistory();
    await refreshFeedPosts();
  }

  useEffect(() => {
    if (!supabase) return;
    if (activePage !== 'posts') return;
    refreshFeedPosts();
  }, [supabase, activePage]);

  async function changeSurahNameOnly() {
    if (!ensureSignedIn(setRenameStatus)) return;
    const surahNumber = Number(renameForm.surah_number);
    const surahName = cleanContent(renameForm.surah_name);
    if (!Number.isInteger(surahNumber) || surahNumber <= 0) {
      setRenameStatus({ text: 'Valid Surah number is required', kind: 'err' });
      return;
    }
    if (!surahName) {
      setRenameStatus({ text: 'New Surah name is required', kind: 'err' });
      return;
    }

    const { error: surahError } = await supabase
      .from('surahs')
      .upsert([{ surah_number: surahNumber, surah_name: surahName }], { onConflict: 'surah_number' });

    if (surahError) {
      setRenameStatus({ text: `Rename failed: ${surahError.message}`, kind: 'err' });
      return;
    }

    const { error: ayahError, count: affectedRows } = await supabase
      .from('ayahs')
      .update({ surah_name: surahName })
      .eq('surah_number', surahNumber)
      .select('surah_number', { count: 'exact', head: true });

    if (ayahError) {
      setRenameStatus({ text: `Surah updated, ayah sync warning: ${ayahError.message}`, kind: 'warn' });
    } else {
      setRenameStatus({ text: `Updated Surah ${surahNumber}. Ayah rows changed: ${affectedRows || 0}`, kind: 'ok' });
    }

    await logUpload(supabase, 'surah_name_change', Number(affectedRows) || 0, `surah_number=${surahNumber}, surah_name=${surahName}`);
    await refreshHistory();
  }

  function parseBulk() {
    try {
      if (!bulkSurahName.trim()) {
        setParseStatus({ text: 'Please enter Surah name first', kind: 'err' });
        return;
      }
      const sourcePostId = Number(bulkPostId) || null;
      let rows = parseTelegramPost(bulkInput, sourcePostId);
      // Set surah_name for all rows
      rows = rows.map(row => ({ ...row, surah_name: bulkSurahName }));
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
            <label className="field">
              <span>Surah Name (for all rows)</span>
              <input value={bulkSurahName} onChange={e => setBulkSurahName(e.target.value)} placeholder="e.g. Al-Fatiha" />
            </label>
          </div>
          <label className="field">
            <span>Telegram Text</span>
            <textarea rows={12} value={bulkInput} onChange={(e) => setBulkInput(e.target.value)} />
          </label>
          {bulkSurahName && (
            <div className="sub" style={{ marginBottom: 8 }}>
              <b>Current Surah Name:</b> {bulkSurahName}
            </div>
          )}
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
              <thead>
                <tr>
                  <th>Surah</th>
                  <th>Name</th>
                  <th>Juz</th>
                  <th>Ayah</th>
                  <th>Arabic</th>
                  <th>Translation</th>
                  <th>Tafseer</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => (
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

    if (activePage === 'post') {
      const previewText = cleanPostText(postForm.content) || 'Your post preview will appear here.';
      const previewScale = clamp(Number(postForm.textScale) || 1, POST_TEXT_SCALE_MIN, POST_TEXT_SCALE_MAX);
      const normalizedTextColor = normalizeHexColor(postForm.textColor);
      const selectedTextColorPreset = TEXT_COLOR_PRESETS.some((x) => x.value === normalizedTextColor)
        ? normalizedTextColor
        : TEXT_COLOR_PRESETS[0].value;
      const stylePreset = getStyle(postForm.styleKey);
      const frame = getFrame(postForm.frameKey);
      const frameTextLayout = getFrameTextLayout(frame.key);
      const effectiveTextStyle = buildTextStyle(stylePreset.textStyle, previewText, previewScale, postForm.textColor);
      return (
        <>
          <div className="head"><h2>Create Post</h2><span className={`pill ${postStatus.kind}`}>{postStatus.text}</span></div>
          <p className="sub">Compose a styled feed card for the app. The saved post carries the same style, frame and size metadata the mobile feed understands.</p>

          <div className="composerShell">
            <div className="composerPanel">
              <label className="field">
                <span>Author Name</span>
                <input
                  value={postForm.author_name}
                  onChange={(e) => setPostForm((p) => ({ ...p, author_name: e.target.value }))}
                  placeholder="Admin"
                />
              </label>

              <label className="field">
                <span>Text Color</span>
                <select
                  className="prettySelect colorSelect"
                  value={selectedTextColorPreset}
                  onChange={(e) => setPostForm((p) => ({ ...p, textColor: e.target.value }))}
                  style={{ color: normalizeHexColor(postForm.textColor) }}
                >
                  {TEXT_COLOR_PRESETS.map((item) => (
                    <option
                      key={item.value}
                      value={item.value}
                      style={{ color: item.value, fontWeight: 700 }}
                    >
                      {item.label}
                    </option>
                  ))}
                </select>
                <div className="colorStrip" aria-label="Color picker">
                  {TEXT_COLOR_PRESETS.map((item) => {
                    const isActive = normalizeHexColor(postForm.textColor) === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        className={`colorChip ${isActive ? 'active' : ''}`}
                        onClick={() => setPostForm((p) => ({ ...p, textColor: item.value }))}
                        title={item.label}
                        aria-label={item.label}
                      >
                        <span className="colorChipSwatch" style={{ backgroundColor: item.value }} />
                        <span className="colorChipLabel">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </label>

              <label className="field">
                <span>Post Text</span>
                <textarea
                  rows={8}
                  value={postForm.content}
                  onChange={(e) => setPostForm((p) => ({ ...p, content: e.target.value }))}
                  placeholder="Write the exact post text that should appear in the feed card..."
                />
              </label>

              <div className="grid g2">
                <label className="field">
                  <span>Font</span>
                  <select
                    className="prettySelect fontSelect"
                    value={postForm.styleKey}
                    onChange={(e) => setPostForm((p) => ({ ...p, styleKey: e.target.value }))}
                    style={getFontPreviewStyle(postForm.styleKey)}
                  >
                    {POST_STYLES.map((item) => (
                      <option key={item.key} value={item.key} style={getFontPreviewStyle(item.key)}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                    <div className="fontStrip" aria-label="Font picker">
                      {POST_STYLES.map((item) => {
                        const isActive = postForm.styleKey === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            className={`fontChip ${isActive ? 'active' : ''}`}
                            onClick={() => setPostForm((p) => ({ ...p, styleKey: item.key }))}
                            title={item.label}
                            aria-label={item.label}
                            style={getFontPreviewStyle(item.key)}
                          >
                            <span className="fontChipSample">Aa</span>
                            <span className="fontChipLabel">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                </label>

                <label className="field">
                  <span>Text Size</span>
                  <div className="rangeWrap">
                    <input
                      type="range"
                      min={POST_TEXT_SCALE_MIN}
                      max={POST_TEXT_SCALE_MAX}
                      step="0.05"
                      value={postForm.textScale}
                      onChange={(e) => setPostForm((p) => ({ ...p, textScale: Number(e.target.value) }))}
                    />
                    <span className="rangeValue">{previewScale.toFixed(2)}x</span>
                  </div>
                </label>
              </div>

              <label className="field">
                <span>Frame</span>
                <div className="frameStrip" role="listbox" aria-label="Frame picker">
                  {FRAME_OPTIONS.map((item) => {
                    const optionFrame = getFrame(item.key);
                    const isActive = postForm.frameKey === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`frameThumbBtn ${isActive ? 'active' : ''}`}
                        onClick={() => setPostForm((p) => ({ ...p, frameKey: item.key }))}
                        aria-selected={isActive}
                        title={item.label}
                      >
                        <div className="frameThumbPreview">
                          {optionFrame.source ? (
                            <img className="frameThumbImage" src={optionFrame.source} alt={item.label} />
                          ) : (
                            <div className="frameThumbPlain">Plain</div>
                          )}
                        </div>
                        <span className="frameThumbLabel">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </label>

            </div>

            <div className="previewPanel">
              <div className="previewHeader">
                <div>
                  <div className="previewKicker">Live Preview</div>
                  <h3>{postForm.author_name || 'Admin'}</h3>
                </div>
                <span className="previewBadge">{frame.label}</span>
              </div>

              <div className="previewPostWrap">
                <div className="previewSquare">
                  {frame.source ? <img className="previewFrameImage" src={frame.source} alt={frame.label} /> : null}
                  <div className="previewTextLayer">
                    <div
                      className={`previewTextSafe ${frameTextLayout.circle ? 'previewTextSafeCircle' : ''}`}
                      style={{
                        width: `${frameTextLayout.widthPct}%`,
                        height: `${frameTextLayout.heightPct}%`,
                        paddingLeft: frameTextLayout.padH,
                        paddingRight: frameTextLayout.padH,
                        paddingTop: frameTextLayout.padV,
                        paddingBottom: frameTextLayout.padV,
                      }}
                    >
                      <div
                        className={`previewText ${getPreviewFontClass(postForm.styleKey)}`}
                        style={{
                          color: effectiveTextStyle.color,
                          fontSize: effectiveTextStyle.fontSize,
                          lineHeight: `${effectiveTextStyle.lineHeight}px`,
                          letterSpacing: effectiveTextStyle.letterSpacing,
                          fontWeight: effectiveTextStyle.fontWeight || '700',
                          fontStyle: effectiveTextStyle.fontStyle || 'normal',
                          textTransform: effectiveTextStyle.textTransform || 'none',
                        }}
                      >
                        {previewText}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="previewFooter">
                  <span>{getStyleLabel(postForm.styleKey)}</span>
                  <span>{frame.label} • {previewScale.toFixed(2)}x</span>
                </div>
              </div>

              <div className="previewNotes">
                <p>Frame keys match the app feed parser, so the selected frame will show there after upload.</p>
              </div>

              <button className="btn gold previewUploadBtn" disabled={isBusy('create_post')} onClick={() => runWithLoading('create_post', createFeedPost)}>
                {isBusy('create_post') ? 'Uploading...' : 'Upload to Feed'}
              </button>
            </div>
          </div>
        </>
      );
    }

    if (activePage === 'surah_name') {
      return (
        <>
          <div className="head"><h2>Change Surah Name</h2><span className={`pill ${renameStatus.kind}`}>{renameStatus.text}</span></div>
          <p className="sub">Update only Surah name for all ayahs of a Surah number.</p>
          <div className="grid g2">
            <label className="field">
              <span>Surah Number</span>
              <input
                value={renameForm.surah_number}
                onChange={(e) => setRenameForm((p) => ({ ...p, surah_number: e.target.value }))}
                placeholder="e.g. 37"
              />
            </label>
            <label className="field">
              <span>New Surah Name</span>
              <input
                value={renameForm.surah_name}
                onChange={(e) => setRenameForm((p) => ({ ...p, surah_name: e.target.value }))}
                placeholder="e.g. As-Saaffaat"
              />
            </label>
          </div>
          <div className="row">
            <button
              className="btn gold"
              disabled={isBusy('rename_surah')}
              onClick={() => runWithLoading('rename_surah', changeSurahNameOnly)}
            >
              {isBusy('rename_surah') ? 'Updating...' : 'Update Surah Name'}
            </button>
          </div>
        </>
      );
    }

    if (activePage === 'posts') {
      return (
        <>
          <div className="head">
            <h2>My Posts</h2>
            <div className="row mini">
              {feedStatus.text ? <span className={`pill ${feedStatus.kind}`}>{feedStatus.text}</span> : null}
              <button
                className="btn ghost"
                disabled={isBusy('feed_refresh')}
                onClick={() => {
                  if (!ensureSignedIn(setFeedStatus)) return;
                  runWithLoading('feed_refresh', () => refreshFeedPosts());
                }}
              >
                {isBusy('feed_refresh') ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
          <p className="sub">View feed posts and delete any post. Deleting here removes it from the app feed too.</p>
          <div className="tableWrap">
            <table>
              <thead><tr><th>ID</th><th>Time</th><th>Author</th><th>Content</th><th>Action</th></tr></thead>
              <tbody>
                {feedPosts.map((post) => {
                  const deleteKey = `del_post_${post.id}`;
                  return (
                    <tr key={post.id}>
                      <td>{post.id}</td>
                      <td>{new Date(post.created_at).toLocaleString()}</td>
                      <td>{post.author_name || 'Anonymous'}</td>
                      <td className="cell-content">{cleanContent(post.content)}</td>
                      <td>
                        <button className="btn ghost" disabled={isBusy(deleteKey)} onClick={() => runWithLoading(deleteKey, () => deleteFeedPost(post))}>
                          {isBusy(deleteKey) ? 'Deleting...' : 'Delete'}
                        </button>
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
