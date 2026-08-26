const STRONG = 'strong';
const MEDIUM = 'medium';
const WEAK = 'weak';

export function normalizeDate(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function attributes(markup) {
  const result = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let match;

  while ((match = pattern.exec(markup))) {
    const key = match[1].toLowerCase();
    const value = match[2];
    result[key] = value && (value.startsWith('"') || value.startsWith("'"))
      ? value.slice(1, -1)
      : value ?? '';
  }

  return result;
}

function metadataTags(html) {
  const tags = [];
  const pattern = /<meta\b([^>]*)>/gi;
  let match;

  while ((match = pattern.exec(html))) tags.push(attributes(match[1]));
  return tags;
}

function dateSignalsFromJson(value, signals) {
  if (Array.isArray(value)) {
    value.forEach((item) => dateSignalsFromJson(item, signals));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const field of ['dateModified', 'datePublished']) {
    if (Object.hasOwn(value, field)) {
      signals.push({ field, raw: value[field], provenance: 'json-ld', strength: STRONG });
    }
  }
  Object.values(value).forEach((item) => dateSignalsFromJson(item, signals));
}

function jsonLdSignals(html) {
  const signals = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    if (attributes(match[1]).type.toLowerCase() !== 'application/ld+json') continue;
    try {
      dateSignalsFromJson(JSON.parse(match[2].trim()), signals);
    } catch {
      // An invalid JSON-LD block does not fabricate a date signal.
    }
  }

  return signals;
}

function openGraphSignals(tags) {
  const fields = ['article:modified_time', 'article:published_time'];
  return tags.flatMap((tag) => fields.includes(tag.property?.toLowerCase()) && tag.content
    ? [{ field: tag.property.toLowerCase(), raw: tag.content, provenance: 'open-graph', strength: STRONG }]
    : []);
}

function standardMetadataSignals(tags) {
  const fields = ['date', 'pubdate', 'last-modified'];
  return tags.flatMap((tag) => {
    const field = tag.name?.toLowerCase() ?? tag.itemprop?.toLowerCase();
    return fields.includes(field) && tag.content
      ? [{ field, raw: tag.content, provenance: 'html-metadata', strength: MEDIUM }]
      : [];
  });
}

function headerValue(headers, name) {
  if (headers?.get) return headers.get(name);
  if (!headers || typeof headers !== 'object') return null;

  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

function httpHeaderSignals(headers) {
  const raw = headerValue(headers, 'last-modified');
  return raw ? [{ field: 'Last-Modified', raw, provenance: 'http-header', strength: WEAK }] : [];
}

function normalizeSignal(signal, source) {
  const raw = typeof signal.raw === 'string' ? signal.raw : String(signal.raw ?? '');
  return {
    title: source.title,
    url: source.url,
    field: signal.field,
    raw,
    normalized: normalizeDate(raw),
    strength: signal.strength,
    provenance: signal.provenance,
  };
}

function firstDistinct(records) {
  return [...new Map(records.map((record) => [record.normalized, record])).values()];
}

function selectStrong(records) {
  const normalized = records.map((record) => ({ ...record, normalized: normalizeDate(record.raw) }));
  const invalid = normalized.find((record) => !record.normalized);
  if (invalid) return { record: invalid, issue: 'invalid' };

  const modified = firstDistinct(normalized.filter((record) => record.field === 'dateModified' || record.field === 'article:modified_time'));
  const published = firstDistinct(normalized.filter((record) => record.field === 'datePublished' || record.field === 'article:published_time'));

  if (modified.length > 1 || published.length > 1) {
    return { record: modified[0] ?? published[0], issue: 'ambiguous' };
  }
  if (modified.length && published.length) {
    return Date.parse(modified[0].normalized) > Date.parse(published[0].normalized)
      ? { record: modified[0] }
      : { record: published[0] };
  }
  if (published.length) return { record: published[0] };
  if (modified.length) return { record: modified[0], issue: 'ambiguous' };
  return null;
}

function selectFallback(records) {
  const normalized = records.map((record) => ({ ...record, normalized: normalizeDate(record.raw) }));
  const invalid = normalized.find((record) => !record.normalized);
  if (invalid) return { record: invalid, issue: 'invalid' };

  const unique = firstDistinct(normalized);
  return unique.length > 1 ? { record: unique[0], issue: 'ambiguous' } : { record: unique[0] };
}

function selectSourceEvidence(source) {
  const html = typeof source.html === 'string' ? source.html : '';
  const tags = metadataTags(html);
  const groups = [
    jsonLdSignals(html),
    openGraphSignals(tags),
    standardMetadataSignals(tags),
    httpHeaderSignals(source.headers),
  ];

  for (const group of groups) {
    if (!group.length) continue;
    const records = group.map((signal) => normalizeSignal(signal, source));
    return records[0].strength === STRONG ? selectStrong(records) : selectFallback(records);
  }
  return null;
}

function unresolved(evidence, message) {
  return { evidence, status: 'unresolved', message };
}

export function resolveMetadata(sources) {
  const selections = sources.map(selectSourceEvidence).filter(Boolean);
  const evidence = selections.map(({ record }) => record);

  if (selections.some(({ issue }) => issue === 'invalid')) {
    return unresolved(evidence, 'Invalid machine-readable date metadata prevents a reliable recency decision.');
  }
  if (selections.some(({ issue }) => issue === 'ambiguous')) {
    return unresolved(evidence, 'Ambiguous machine-readable date metadata needs human review.');
  }

  const strongEvidence = evidence.filter((record) => record.strength === STRONG);
  const strongSourceCount = new Set(strongEvidence.map((record) => record.url || record.title)).size;
  if (strongSourceCount < 2) {
    return unresolved(evidence, 'Insufficient strong date metadata: two independent sources are required; weak headers are corroboration only.');
  }

  const newest = [...strongEvidence].sort((left, right) => Date.parse(right.normalized) - Date.parse(left.normalized))[0];
  const newestCount = strongEvidence.filter((record) => record.normalized === newest.normalized).length;
  if (newestCount > 1) {
    return unresolved(evidence, 'Ambiguous machine-readable date metadata: the newest strong sources have the same timestamp.');
  }

  return {
    evidence,
    status: 'resolved',
    newest,
    message: `${newest.title} has the newest strong machine-readable ${newest.field} signal (${newest.provenance}).`,
  };
}
