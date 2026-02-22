export function cleanContent(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeArabicText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[*_`~]+/g, ' ')
    .replace(/^[\s\-–—•▪◾◼◆◇●○▶►■□✦✧★☆]+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeLine(line) {
  return String(line || '').replace(/\r/g, '').replace(/^\s+|\s+$/g, '');
}

function unwrapTranslation(text) {
  let out = cleanContent(text);
  let changed = true;
  while (changed) {
    changed = false;
    const next = out
      .replace(/^_([\s\S]+)_$/g, '$1')
      .replace(/^"([\s\S]+)"$/g, '$1')
      .replace(/^\u201C([\s\S]+)\u201D$/g, '$1')
      .replace(/^\*([\s\S]+)\*$/g, '$1')
      .trim();
    if (next !== out) {
      out = next;
      changed = true;
    }
  }
  return out;
}

export function normalizeIncomingRow(row) {
  const surahNumber = Number(row?.surah_number);
  const ayahNumber = Number(row?.ayah_number);
  const juzNumber =
    row?.juz_number === null || row?.juz_number === undefined || row?.juz_number === ''
      ? null
      : Number(row.juz_number);
  return {
    surah_number: Number.isInteger(surahNumber) ? surahNumber : surahNumber,
    surah_name: cleanContent(row?.surah_name || ''),
    juz_number: Number.isInteger(juzNumber) ? juzNumber : null,
    ayah_number: Number.isInteger(ayahNumber) ? ayahNumber : ayahNumber,
    arabic_text: normalizeArabicText(row?.arabic_text || ''),
    translation: cleanContent(row?.translation || ''),
    tafseer: cleanContent(row?.tafseer || ''),
    source_post_id:
      row?.source_post_id === null || row?.source_post_id === undefined || row?.source_post_id === ''
        ? null
        : Number(row.source_post_id),
  };
}

function rowQualityScore(row) {
  let score = 0;
  if (row.arabic_text) score += 3;
  if (row.translation) score += 2;
  if (row.tafseer) score += 1;
  return score;
}

export function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.surah_number}:${row.ayah_number}`;
    if (!map.has(key)) {
      map.set(key, row);
      continue;
    }
    const prev = map.get(key);
    map.set(key, rowQualityScore(row) >= rowQualityScore(prev) ? row : prev);
  }
  return Array.from(map.values()).sort(
    (a, b) => a.surah_number - b.surah_number || a.ayah_number - b.ayah_number
  );
}

export function validateRows(rows) {
  const report = {
    total: rows.length,
    invalidRequired: 0,
    missingArabic: 0,
    missingTranslation: 0,
    missingTafseer: 0,
    duplicateKeys: 0,
    uniqueKeys: 0,
    warnings: [],
  };

  const seen = new Set();
  for (const row of rows) {
    const key = `${row.surah_number}:${row.ayah_number}`;
    const validRequired =
      Number.isInteger(row.surah_number) &&
      row.surah_number > 0 &&
      Number.isInteger(row.ayah_number) &&
      row.ayah_number > 0 &&
      !!row.surah_name;

    if (!validRequired) report.invalidRequired += 1;
    if (!row.arabic_text) report.missingArabic += 1;
    if (!row.translation) report.missingTranslation += 1;
    if (!row.tafseer) report.missingTafseer += 1;
    if (seen.has(key)) report.duplicateKeys += 1;
    seen.add(key);
  }

  report.uniqueKeys = seen.size;
  if (report.missingArabic > 0) report.warnings.push(`Missing Arabic: ${report.missingArabic}`);
  if (report.missingTranslation > 0) report.warnings.push(`Missing Translation: ${report.missingTranslation}`);
  if (report.missingTafseer > 0) report.warnings.push(`Missing Tafseer: ${report.missingTafseer}`);
  if (report.duplicateKeys > 0) report.warnings.push(`Duplicate Keys: ${report.duplicateKeys}`);
  return report;
}

function extractHeader(rawText) {
  const text = String(rawText || '');
  const surahMatch = text.match(/Surah\s*No\.?\s*(\d+)\s*,?\s*([^\n*]+)/i);
  const juzMatch = text.match(/Juz\s*[-\u2013:]?\s*(\d+)/i);
  return {
    surahNumber: surahMatch ? Number(surahMatch[1]) : null,
    surahName: surahMatch ? cleanContent(surahMatch[2] || '') : '',
    juzNumber: juzMatch ? Number(juzMatch[1]) : null,
  };
}

function splitAyahBlocks(rawText) {
  const text = String(rawText || '');
  const marker = /(?:^|\n)[^\n]*Aayat\s*No\.?\s*([0-9]+(?:\s*[-\u2013]\s*[0-9]+)?)[^\n]*\n?/gim;
  const hits = Array.from(text.matchAll(marker));
  const blocks = [];
  for (let i = 0; i < hits.length; i += 1) {
    const start = (hits[i].index || 0) + hits[i][0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index || text.length : text.length;
    blocks.push({ marker: hits[i][1], body: text.slice(start, end) });
  }
  return blocks;
}

function parseAyahRange(rangeLabel) {
  const m = String(rangeLabel || '').match(/^\s*(\d+)(?:\s*[-\u2013]\s*(\d+))?\s*$/);
  if (!m) return [];
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return [];
  const out = [];
  for (let n = start; n <= end; n += 1) out.push(n);
  return out;
}

function isArabicLine(line) {
  return /[\u0600-\u06FF]/.test(line || '');
}

function isTranslationLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (/^_.*_$/.test(t) || /^".*"$/.test(t) || /^\u201C.*\u201D$/.test(t)) return true;
  return /[A-Za-z]/.test(t) && (t.includes('_') || t.includes('"'));
}

function parseBlock(markerLabel, bodyText) {
  const ayahNumbers = parseAyahRange(markerLabel);
  if (!ayahNumbers.length) return [];
  const rawLines = cleanContent(bodyText).split('\n').map(normalizeLine).filter(Boolean);
  const pairs = [];
  const used = new Set();

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    if (!isArabicLine(line)) continue;
    let translation = '';
    for (let j = i + 1; j < rawLines.length && j <= i + 3; j += 1) {
      if (isTranslationLine(rawLines[j])) {
        translation = unwrapTranslation(rawLines[j]);
        used.add(j);
        break;
      }
    }
    pairs.push({ arabic: cleanContent(line), translation });
    used.add(i);
  }

  const tafseerLines = rawLines
    .filter((_, idx) => !used.has(idx))
    .filter((line) => !/^\{?\s*Description of this aayat/i.test(line))
    .map((line) =>
      line.replace(
        /^[\u25C6\u25C7\u25B8\u25B9\u2605\u2606\u2726\u2727\u2736\u2747\u2B50\u{1F300}-\u{1FAFF}]+\s*/gu,
        ''
      )
    )
    .map((line) => line.trim())
    .filter(Boolean);
  const sharedTafseer = cleanContent(tafseerLines.join('\n\n'));

  return ayahNumbers.map((ayahNo, idx) => {
    const pair = pairs[idx] || pairs[0] || { arabic: '', translation: '' };
    return {
      ayah_number: ayahNo,
      arabic_text: normalizeArabicText(pair.arabic || ''),
      translation: cleanContent(pair.translation || ''),
      tafseer: sharedTafseer,
    };
  });
}

export function parseTelegramPost(rawText, sourcePostId) {
  const header = extractHeader(rawText);
  if (!header.surahNumber) throw new Error('Could not detect Surah number');
  const blocks = splitAyahBlocks(rawText);
  if (!blocks.length) throw new Error('No ayah blocks found');
  const rows = [];
  for (const block of blocks) {
    const parsed = parseBlock(block.marker, block.body);
    for (const row of parsed) {
      rows.push(
        normalizeIncomingRow({
          surah_number: header.surahNumber,
          surah_name: header.surahName || `Surah ${header.surahNumber}`,
          juz_number: header.juzNumber || null,
          ayah_number: row.ayah_number,
          arabic_text: row.arabic_text || '',
          translation: row.translation || '',
          tafseer: row.tafseer || '',
          source_post_id: sourcePostId || null,
        })
      );
    }
  }
  return dedupeRows(rows);
}

export function summarizeReport(report) {
  return `total=${report.total}, unique=${report.uniqueKeys}, invalid=${report.invalidRequired}, missingArabic=${report.missingArabic}, missingTranslation=${report.missingTranslation}, missingTafseer=${report.missingTafseer}, duplicates=${report.duplicateKeys}`;
}
