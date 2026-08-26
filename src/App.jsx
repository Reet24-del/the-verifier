import { useMemo, useState } from 'react'
import { demoBrief, investigation } from './data.js'
import { resolveMetadata } from './lib/dateMetadata.js'

const sourceGroups = [
  { key: 'finder', label: 'Current Claim Finder', description: 'Seeks current evidence supporting the claim.', tone: 'amber' },
  { key: 'hunter', label: 'Contradiction Hunter', description: 'Actively searches for conflicting public evidence.', tone: 'red' },
]

function Icon({ children }) {
  return <span aria-hidden="true" className="icon">{children}</span>
}

function SourceCard({ source }) {
  const isSupport = source.state === 'supports'
  return (
    <article className="source-card">
      <p className="source-title">{source.title}</p>
      <p className="source-host">{source.host}</p>
      <p className="source-claim">“{source.claim}”</p>
      <p className={`source-state ${isSupport ? 'positive' : 'negative'}`}>
        <span /> {isSupport ? 'Supports claim' : 'Contradicts claim'}
      </p>
    </article>
  )
}

export default function App() {
  const [brief, setBrief] = useState(demoBrief)
  const [runState, setRunState] = useState('ready')
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState('')
  const allSources = useMemo(() => [...investigation.finder, ...investigation.hunter], [])
  const resolver = useMemo(() => resolveMetadata(allSources), [allSources])

  const runInvestigation = () => {
    setRunState('running')
    setSaved(false)
    setNotice('Both research agents are working in parallel…')
    window.setTimeout(() => {
      setRunState('complete')
      setNotice('Conflict found. Sandbox metadata check completed.')
    }, 1100)
  }

  const approve = () => {
    setSaved(true)
    setNotice('Dossier saved only after your approval.')
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">THE VERIFIER</div>
        <div className="session"><span className="live-dot" /> Session active · approval required for save</div>
        <button className="button secondary" onClick={() => setNotice('Export becomes available after approval.')}>Export dossier</button>
      </header>

      <div className="workspace">
        <section className="primary-column">
          <section className="panel brief-panel">
            <div className="section-heading"><span>1.</span> Spoken brief <em>{runState === 'ready' ? '(ready)' : '(captured)'}</em></div>
            <div className="brief-input-wrap">
              <Icon>◉</Icon>
              <textarea aria-label="Brief to verify" value={brief} onChange={(event) => setBrief(event.target.value)} />
              <button className="button compact" onClick={runInvestigation}>{runState === 'running' ? 'Investigating…' : 'Verify brief'}</button>
            </div>
            <p className="input-meta">Voice or text input · This demo uses a pinned public-source case</p>
          </section>

          <section className="panel timeline-panel">
            <div className="section-heading"><span>2.</span> Investigation timeline <em>two adversarial agents</em></div>
            <div className="timeline-scale"><span>0s</span><span>15s</span><span>30s</span><span>45s</span><span>60s</span></div>
            {sourceGroups.map((group) => (
              <div className="agent-row" key={group.key}>
                <div className={`agent-label ${group.tone}`}><strong>{group.label}</strong><small>{group.description}</small></div>
                <div className="source-stream">{investigation[group.key].map((source) => <SourceCard source={source} key={source.title} />)}</div>
              </div>
            ))}
            {runState !== 'ready' && <div className="conflict"><Icon>!</Icon><div><strong>Conflict detected</strong><p>Recent public sources disagree on who holds the CEO role. The resolver compares their source-date evidence.</p></div><span>{runState === 'running' ? 'Checking…' : 'Escalated'}</span></div>}
          </section>

          <section className="panel resolver-panel">
            <div className="section-heading"><span>3.</span> Sandbox — date-metadata resolver <em>deterministic code check</em></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Source</th><th>Metadata field</th><th>Raw value</th><th>Normalized (UTC)</th></tr></thead>
                <tbody>{resolver.evidence.map((item) => <tr key={item.source}><td>{item.source}</td><td>{item.field}</td><td>{item.raw}</td><td>{item.normalized}</td></tr>)}</tbody>
              </table>
            </div>
            <p className={`resolver-result ${resolver.status}`}>{resolver.status === 'resolved' ? 'Resolved:' : 'Unresolved:'} {resolver.message}</p>
          </section>

          <section className="approval-panel">
            <div><div className="section-heading"><span>4.</span> Human approval</div><h2>Save this verified brief?</h2><p>Saving is an irreversible session action. The agent is blocked until you decide.</p></div>
            <div className="approval-actions"><button className="button primary" disabled={runState !== 'complete'} onClick={approve}>Approve & save</button><button className="button secondary" onClick={() => setNotice('Investigation retained. No dossier was saved.')}>Keep investigating</button></div>
          </section>
          {notice && <p className="notice" role="status">{notice}</p>}
        </section>

        <aside className="dossier panel">
          <div className="section-heading">Dossier</div>
          <section className="conclusion"><p>Overall conclusion</p><h1>{runState === 'ready' ? 'Awaiting evidence' : resolver.status === 'resolved' ? 'Conflict resolved' : 'Needs review'}</h1><p>{runState === 'ready' ? 'Run the investigation to construct a source-backed brief.' : 'Official company records have the newest strong machine-readable date evidence. The original CEO claim is not supported as current.'}</p></section>
          <section className="dossier-section"><p className="dossier-label">Evidence summary</p>{allSources.map((source) => <div className="evidence-item" key={source.title}><span className={source.state === 'supports' ? 'support-dot' : 'conflict-dot'} /><div><strong>{source.title}</strong><small>{source.host}</small></div><em>{source.state === 'supports' ? 'Supports' : 'Contradicts'}</em></div>)}</section>
          <section className="dossier-section status-box"><p className="dossier-label">Dossier status</p><strong className={saved ? 'saved' : 'draft'}>{saved ? 'Saved with approval' : 'Not saved'}</strong><p>{saved ? 'A session record has been created.' : 'No data has left this session.'}</p></section>
        </aside>
      </div>
    </main>
  )
}
