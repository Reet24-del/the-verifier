const DATE_FIELDS = [
  ['dateModified', 'JSON-LD dateModified', 'strong'],
  ['datePublished', 'JSON-LD datePublished', 'strong'],
  ['article:modified_time', 'Open Graph article:modified_time', 'strong'],
  ['article:published_time', 'Open Graph article:published_time', 'strong'],
  ['last-modified', 'HTML last-modified', 'medium'],
]

export function normalizeDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function resolveMetadata(sources) {
  const evidence = sources.flatMap((source) => {
    const match = DATE_FIELDS.find(([key]) => source.metadata[key])
    if (!match) return []
    const [key, field, strength] = match
    const normalized = normalizeDate(source.metadata[key])
    return normalized ? [{ source: source.title, field, strength, raw: source.metadata[key], normalized }] : []
  })

  const strongEvidence = evidence.filter((item) => item.strength === 'strong')
  if (strongEvidence.length < 2) {
    return { evidence, status: 'unresolved', message: 'Insufficient strong date metadata to establish recency.' }
  }

  const newest = [...strongEvidence].sort((a, b) => b.normalized.localeCompare(a.normalized))[0]
  return {
    evidence,
    status: 'resolved',
    newest,
    message: `${newest.source} has the newest strong machine-readable date signal.`,
  }
}
