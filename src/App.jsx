import { useMemo, useState } from 'react'
import { getDossier, runVerification, submitApproval } from './lib/verifierApi.js'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
const defaultApi = {
  runVerification: (options) => runVerification({ ...options, apiBaseUrl }),
  submitApproval: (options) => submitApproval({ ...options, apiBaseUrl }),
  getDossier: (options) => getDossier({ ...options, apiBaseUrl }),
}
const defaultBrief = 'Verify that Brian Niccol is CEO of Starbucks.'

const sourceGroups = [
  { key: 'current', label: 'Current Claim Finder', description: 'Seeks current evidence supporting the claim.', tone: 'amber' },
  { key: 'contradiction', label: 'Contradiction Hunter', description: 'Actively searches for conflicting public evidence.', tone: 'red' },
]

function Icon({ children }) {
  return <span aria-hidden="true" className="icon">{children}</span>
}

function sourceHost(url) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function SourceCard({ source }) {
  const isSupport = source.stance === 'supports'
  return (
    <article className="source-card">
      <p className="source-title">{source.title}</p>
      <p className="source-host">{sourceHost(source.url)}</p>
      <p className="source-claim">“{source.claim}”</p>
      <p className={`source-state ${isSupport ? 'positive' : 'negative'}`}>
        <span /> {isSupport ? 'Supports claim' : 'Contradicts claim'}
      </p>
    </article>
  )
}

function conclusionFor(runState, result) {
  if (runState === 'running') return { title: 'Research in progress', text: 'Two opposing research lanes are checking the brief.' }
  if (runState === 'error') return { title: 'Investigation failed', text: 'The server did not return a completed verification. You can safely try again.' }
  if (!result) return { title: 'Awaiting evidence', text: 'Run the investigation to construct a source-backed brief.' }
  return {
    title: result.status === 'resolved' ? 'Conflict resolved' : 'Needs review',
    text: result.summary,
  }
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export default function App({ api = defaultApi, saveJson = downloadJson }) {
  const [brief, setBrief] = useState(defaultBrief)
  const [runState, setRunState] = useState('ready')
  const [workflow, setWorkflow] = useState(null)
  const [session, setSession] = useState(null)
  const [notice, setNotice] = useState('')
  const [exporting, setExporting] = useState(false)

  const result = workflow?.result ?? null
  const resolver = result?.resolution ?? null
  const findingsByAngle = useMemo(
    () => Object.fromEntries((result?.findings ?? []).map((finding) => [finding.angle, finding.sources])),
    [result],
  )
  const allSources = useMemo(() => (result?.findings ?? []).flatMap((finding) => finding.sources), [result])
  const hasConflict = allSources.some((source) => source.stance === 'supports')
    && allSources.some((source) => source.stance === 'contradicts')
  const conclusion = conclusionFor(runState, result)
  const isBusy = runState === 'running' || runState === 'saving'
  const awaitingApproval = runState === 'awaiting_approval'

  const runInvestigation = async () => {
    if (!brief.trim()) {
      setRunState('error')
      setNotice('Enter a brief before starting the investigation.')
      return
    }

    setRunState('running')
    setWorkflow(null)
    setSession(null)
    setNotice('Both research agents are working in parallel…')
    try {
      const completed = await api.runVerification({ brief })
      setWorkflow(completed)
      setSession(completed.session)
      setRunState('awaiting_approval')
      setNotice('Conflict checked. The server is awaiting your approval before saving anything.')
    } catch (error) {
      setRunState('error')
      setNotice(error instanceof Error ? error.message : 'Workflow execution failed')
    }
  }

  const decide = async (approved) => {
    if (!session?.id || !workflow?.approvalToken || !awaitingApproval) return

    setRunState(approved ? 'saving' : 'rejecting')
    setNotice(approved ? 'Saving the approved dossier…' : 'Recording your decision without saving…')
    try {
      const response = await api.submitApproval({
        sessionId: session.id,
        approvalToken: workflow.approvalToken,
        approved,
      })
      if (approved && response.session?.status !== 'saved') {
        throw new Error('The server did not confirm dossier persistence.')
      }
      setSession(response.session)
      setWorkflow((current) => ({ ...current, approvalToken: null }))
      setRunState(approved ? 'saved' : 'rejected')
      setNotice(approved
        ? 'The server persisted the dossier after your approval.'
        : 'Approval rejected. The server saved no dossier.')
    } catch (error) {
      setRunState('awaiting_approval')
      setNotice(error instanceof Error ? error.message : 'The approval request failed')
    }
  }

  const exportDossier = async () => {
    if (runState !== 'saved' || !session?.id || exporting) return

    setExporting(true)
    setNotice('Preparing the saved dossier…')
    try {
      const dossier = await api.getDossier({ sessionId: session.id })
      saveJson(`the-verifier-${session.id}.json`, dossier)
      setNotice('Dossier downloaded from the server-persisted record.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Dossier export failed')
    } finally {
      setExporting(false)
    }
  }

  const verifyButtonLabel = runState === 'running'
    ? 'Investigating…'
    : runState === 'error'
      ? 'Try again'
      : 'Verify brief'

  const dossierStatus = runState === 'saved'
    ? { label: 'Saved with approval', className: 'saved', text: 'The server persisted the dossier after your approval.' }
    : runState === 'rejected'
      ? { label: 'Not saved', className: 'draft', text: 'You rejected approval, so the server saved nothing.' }
      : awaitingApproval
        ? { label: 'Awaiting your approval', className: 'draft', text: 'The server is blocked until you decide.' }
        : { label: 'Not saved', className: 'draft', text: 'No dossier has been persisted.' }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">THE VERIFIER</div>
        <div className="session"><span className="live-dot" /> Session {session?.id ? session.status.replaceAll('_', ' ') : 'ready'} · approval required for save</div>
        <button className="button secondary" disabled={runState !== 'saved' || exporting} onClick={exportDossier}>{exporting ? 'Preparing…' : 'Export dossier'}</button>
      </header>

      <div className="workspace">
        <section className="primary-column">
          <section className="panel brief-panel">
            <div className="section-heading"><span>1.</span> Spoken brief <em>{runState === 'ready' ? '(ready)' : '(captured)'}</em></div>
            <div className="brief-input-wrap">
              <Icon>◉</Icon>
              <textarea aria-label="Brief to verify" value={brief} disabled={isBusy} onChange={(event) => setBrief(event.target.value)} />
              <button className="button compact" disabled={isBusy || !brief.trim()} onClick={runInvestigation}>{verifyButtonLabel}</button>
            </div>
            <p className="input-meta">Voice or text input · Fixture mode uses pinned public Starbucks sources</p>
          </section>

          <section className="panel timeline-panel">
            <div className="section-heading"><span>2.</span> Investigation timeline <em>two adversarial agents</em></div>
            <div className="timeline-scale"><span>0s</span><span>15s</span><span>30s</span><span>45s</span><span>60s</span></div>
            {sourceGroups.map((group) => {
              const sources = findingsByAngle[group.key] ?? []
              return (
                <div className="agent-row" key={group.key}>
                  <div className={`agent-label ${group.tone}`}><strong>{group.label}</strong><small>{group.description}</small></div>
                  <div className="source-stream">
                    {sources.length
                      ? sources.map((source) => <SourceCard source={source} key={source.url} />)
                      : <div className={`source-empty ${runState === 'running' ? 'active' : ''}`}>{runState === 'running' ? 'Researching public sources…' : 'Evidence will appear after verification.'}</div>}
                  </div>
                </div>
              )
            })}
            {hasConflict && <div className="conflict"><Icon>!</Icon><div><strong>Conflict detected</strong><p>Public sources disagree on the claim. The resolver compared their machine-readable date evidence.</p></div><span>Escalated</span></div>}
          </section>

          <section className="panel resolver-panel">
            <div className="section-heading"><span>3.</span> Sandbox — date-metadata resolver <em>deterministic code check</em></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Source</th><th>Metadata field</th><th>Raw value</th><th>Normalized (UTC)</th></tr></thead>
                <tbody>
                  {resolver?.evidence?.length
                    ? resolver.evidence.map((item) => <tr key={`${item.url}-${item.field}`}><td>{item.title}</td><td>{item.field}</td><td>{item.raw}</td><td>{item.normalized ?? 'Invalid'}</td></tr>)
                    : <tr><td className="empty-cell" colSpan="4">No metadata evidence yet.</td></tr>}
                </tbody>
              </table>
            </div>
            {resolver && <p className={`resolver-result ${resolver.status}`}>{resolver.status === 'resolved' ? 'Resolved:' : 'Unresolved:'} {resolver.message}</p>}
          </section>

          <section className="approval-panel">
            <div><div className="section-heading"><span>4.</span> Human approval</div><h2>Save this verified brief?</h2><p>Saving is an irreversible session action. The server is blocked until you decide.</p></div>
            <div className="approval-actions">
              <button className="button primary" disabled={!awaitingApproval} onClick={() => decide(true)}>{runState === 'saving' ? 'Saving…' : 'Approve & save'}</button>
              <button className="button secondary" disabled={!awaitingApproval} onClick={() => decide(false)}>Keep investigating</button>
            </div>
          </section>
          {notice && <p className={`notice ${runState === 'error' ? 'error' : ''}`} role={runState === 'error' ? 'alert' : 'status'}>{notice}</p>}
        </section>

        <aside className="dossier panel">
          <div className="section-heading">Dossier</div>
          <section className="conclusion"><p>Overall conclusion</p><h1>{conclusion.title}</h1><p>{conclusion.text}</p></section>
          <section className="dossier-section">
            <p className="dossier-label">Evidence summary</p>
            {allSources.length
              ? allSources.map((source) => <div className="evidence-item" key={source.url}><span className={source.stance === 'supports' ? 'support-dot' : 'conflict-dot'} /><div><strong>{source.title}</strong><small>{sourceHost(source.url)}</small></div><em>{source.stance === 'supports' ? 'Supports' : 'Contradicts'}</em></div>)
              : <p className="empty-summary">No evidence collected yet.</p>}
          </section>
          <section className="dossier-section status-box"><p className="dossier-label">Dossier status</p><strong className={dossierStatus.className}>{dossierStatus.label}</strong><p>{dossierStatus.text}</p></section>
        </aside>
      </div>
    </main>
  )
}
