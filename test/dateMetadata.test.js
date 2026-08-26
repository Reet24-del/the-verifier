import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMetadata } from '../src/lib/dateMetadata.js';

function source(title, url, html = '', headers = {}) {
  return { title, url, html, headers, metadata: {} };
}

test('prefers JSON-LD publication metadata over a newer Open Graph timestamp', () => {
  const result = resolveMetadata([
    source('Structured source', 'https://example.test/structured', `
      <script type="application/ld+json">{"datePublished":"2026-08-10T08:00:00Z"}</script>
      <meta property="article:modified_time" content="2026-08-30T08:00:00Z">
    `),
    source('Comparison source', 'https://example.test/comparison', `
      <script type="application/ld+json">{"datePublished":"2026-08-09T08:00:00Z"}</script>
    `),
  ]);

  assert.equal(result.status, 'resolved');
  assert.equal(result.newest.title, 'Structured source');
  assert.equal(result.newest.url, 'https://example.test/structured');
  assert.equal(result.newest.field, 'datePublished');
  assert.equal(result.newest.raw, '2026-08-10T08:00:00Z');
  assert.equal(result.newest.normalized, '2026-08-10T08:00:00.000Z');
  assert.equal(result.newest.strength, 'strong');
  assert.equal(result.newest.provenance, 'json-ld');
});

test('returns unresolved when a selected strong date is invalid', () => {
  const result = resolveMetadata([
    source('Invalid source', 'https://example.test/invalid', `
      <script type="application/ld+json">{"datePublished":"not-a-date"}</script>
    `),
    source('Valid source', 'https://example.test/valid', `
      <script type="application/ld+json">{"datePublished":"2026-08-10T08:00:00Z"}</script>
    `),
  ]);

  assert.equal(result.status, 'unresolved');
  assert.match(result.message, /invalid/i);
  assert.equal(result.evidence[0].raw, 'not-a-date');
  assert.equal(result.evidence[0].normalized, null);
});

test('returns unresolved when only HTTP Last-Modified headers are available', () => {
  const result = resolveMetadata([
    source('Header A', 'https://example.test/a', '', { 'last-modified': 'Mon, 10 Aug 2026 08:00:00 GMT' }),
    source('Header B', 'https://example.test/b', '', { 'Last-Modified': 'Tue, 11 Aug 2026 08:00:00 GMT' }),
  ]);

  assert.equal(result.status, 'unresolved');
  assert.equal(result.evidence.length, 2);
  assert.deepEqual(result.evidence.map(({ strength, provenance }) => ({ strength, provenance })), [
    { strength: 'weak', provenance: 'http-header' },
    { strength: 'weak', provenance: 'http-header' },
  ]);
  assert.match(result.message, /insufficient|weak/i);
});

test('returns unresolved when strong sources have the same selected date', () => {
  const result = resolveMetadata([
    source('Source A', 'https://example.test/a', '<script type="application/ld+json">{"datePublished":"2026-08-10T08:00:00Z"}</script>'),
    source('Source B', 'https://example.test/b', '<script type="application/ld+json">{"datePublished":"2026-08-10T08:00:00Z"}</script>'),
  ]);

  assert.equal(result.status, 'unresolved');
  assert.equal(result.newest, undefined);
  assert.match(result.message, /ambiguous/i);
});

test('selects the newest structured dateModified only when it is later than that source publication date', () => {
  const result = resolveMetadata([
    source('Updated source', 'https://example.test/updated', '<script type="application/ld+json">{"datePublished":"2026-08-10T08:00:00Z","dateModified":"2026-08-20T08:00:00Z"}</script>'),
    source('Newer publication', 'https://example.test/newer', '<script type="application/ld+json">{"datePublished":"2026-08-18T08:00:00Z"}</script>'),
  ]);

  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.newest, {
    title: 'Updated source',
    url: 'https://example.test/updated',
    field: 'dateModified',
    raw: '2026-08-20T08:00:00Z',
    normalized: '2026-08-20T08:00:00.000Z',
    strength: 'strong',
    provenance: 'json-ld',
  });
  assert.match(result.message, /Updated source.*newest/i);
});

test('returns unresolved when two strong signals come from the same source', () => {
  const result = resolveMetadata([
    source('Repeated source', 'https://example.test/repeated', '<script type="application/ld+json">{"datePublished":"2026-08-10T08:00:00Z"}</script>'),
    source('Repeated source', 'https://example.test/repeated', '<script type="application/ld+json">{"datePublished":"2026-08-20T08:00:00Z"}</script>'),
  ]);

  assert.equal(result.status, 'unresolved');
  assert.match(result.message, /two.*source|independent/i);
});
