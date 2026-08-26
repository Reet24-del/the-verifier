export const demoBrief = 'I’m meeting Maya Chen. She says she is CEO of Northstar AI.'

export const investigation = {
  finder: [
    { title: 'Northstar AI — Press kit', host: 'northstar.example/press', claim: 'Maya Chen is Chief Executive Officer.', state: 'supports', metadata: { dateModified: '2026-08-19T13:40:00-04:00' } },
    { title: 'TechToday — Leadership profile', host: 'techtoday.example/maya-chen', claim: 'Maya Chen was appointed CEO of Northstar AI.', state: 'supports', metadata: { 'article:published_time': '2026-08-12T10:15:00-07:00' } },
  ],
  hunter: [
    { title: 'Northstar AI — Company record', host: 'registry.example/northstar', claim: 'Arjun Patel is listed as CEO; Maya Chen as COO.', state: 'contradicts', metadata: { datePublished: '2026-08-21T09:30:00Z' } },
    { title: 'Investor filing — Form D', host: 'filings.example/northstar', claim: 'Principal executive: Arjun Patel.', state: 'contradicts', metadata: { datePublished: '2026-08-20T22:31:45Z' } },
  ],
}
