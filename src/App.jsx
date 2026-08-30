import { useMemo, useRef, useState } from 'react'
import { getDossier, runVerification, submitApproval } from './lib/verifierApi.js'
import { approvalDecisionFromTranscript, buildApprovalPrompt, createBrowserVoice } from './lib/speech.js'

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
      <div className="source-card-topline">
        <p className={`source-state ${isSupport ? 'positive' : 'negative'}`}>
          <span /> {isSupport ? 'Supports claim' : 'Contradicts claim'}
        </p>
        <p className="source-host">{sourceHost(source.url)}</p>
      </div>
      <p className="source-title">{source.title}</p>
      <p className="source-claim">“{source.claim}”</p>
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

export default function App({ api = defaultApi, saveJson = downloadJson, voice = createBrowserVoice() }) {
  const [brief, setBrief] = useState(defaultBrief)
  const [spokenBrief, setSpokenBrief] = useState('')
  const [runState, setRunState] = useState('ready')
  const [workflow, setWorkflow] = useState(null)
  const [session, setSession] = useState(null)
  const [notice, setNotice] = useState('')
  const [exporting, setExporting] = useState(false)
  const [listeningFor, setListeningFor] = useState(null)
  const [approvalPrompt, setApprovalPrompt] = useState('')
  const [narrating, setNarrating] = useState(false)
  const approvalActionRef = useRef(false)

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
  const isBusy = runState === 'running' || runState === 'saving' || runState === 'rejecting' || listeningFor !== null || narrating
  const awaitingApproval = runState === 'awaiting_approval'

  const captureBrief = async () => {
    setListeningFor('brief')
    setNotice('Listening for your name and claim…')
    try {
      const transcript = await voice.listen()
      setBrief(transcript)
      setSpokenBrief(transcript)
      setNotice(`I heard: “${transcript}” Confirm it below or edit the text first.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Speech capture failed. Type your brief instead.')
    } finally {
      setListeningFor(null)
    }
  }

  const runInvestigation = async () => {
    if (!brief.trim()) {
      setRunState('error')
      setNotice('Enter a brief before starting the investigation.')
      return
    }

    setRunState('running')
    setWorkflow(null)
    setSession(null)
    setApprovalPrompt('')
    approvalActionRef.current = false
    setNotice('Both research agents are working in parallel…')
    try {
      const completed = await api.runVerification({ brief })
      const prompt = buildApprovalPrompt(completed.result)
      setWorkflow(completed)
      setSession(completed.session)
      setRunState('awaiting_approval')
      setSpokenBrief('')
      setApprovalPrompt(prompt)
      setNotice('Conflict checked. The server is awaiting your approval before saving anything.')
      setNarrating(true)
      await voice.speak(prompt)
      setNarrating(false)
    } catch (error) {
      setNarrating(false)
      setRunState('error')
      setNotice(error instanceof Error ? error.message : 'Workflow execution failed')
    }
  }

  const decide = async (approved, lockHeld = false) => {
    if (!lockHeld) {
      if (approvalActionRef.current) return
      approvalActionRef.current = true
    }
    if (!session?.id || !workflow?.approvalToken || !awaitingApproval) {
      if (!lockHeld) approvalActionRef.current = false
      return
    }

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
      void voice.speak(approved ? 'Saved.' : 'Not saved. Tell me what you would like to adjust.')
    } catch (error) {
      approvalActionRef.current = false
      setRunState('awaiting_approval')
      setNotice(error instanceof Error ? error.message : 'The approval request failed')
    }
  }

  const captureApproval = async () => {
    if (!awaitingApproval || approvalActionRef.current || narrating) return
    approvalActionRef.current = true
    setListeningFor('approval')
    setNotice('Listening for yes or no…')
    try {
      const transcript = await voice.listen()
      const approved = approvalDecisionFromTranscript(transcript)
      if (approved === null) {
        approvalActionRef.current = false
        setNotice(`I heard “${transcript}”, but need a clear yes or no. You can also use the buttons.`)
        return
      }
      await decide(approved, true)
    } catch (error) {
      approvalActionRef.current = false
      setNotice(error instanceof Error ? error.message : 'Voice approval failed. Use the buttons instead.')
    } finally {
      setListeningFor(null)
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
    : spokenBrief
      ? 'Confirm & verify'
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

  const activeStep = runState === 'ready' || runState === 'error'
    ? 1
    : runState === 'running'
      ? 2
      : resolver
        ? 4
        : 3
  const workflowSteps = ['Brief', 'Research', 'Resolve', 'Approve']
  const dossierBadge = runState === 'saved' ? 'Saved' : awaitingApproval ? 'Approval pending' : 'Draft'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-kicker">Evidence operations</span>
          <div className="brand">THE VERIFIER</div>
        </div>
        <div className="session"><span className="live-dot" /> Session {session?.id ? session.status.replaceAll('_', ' ') : 'ready'} <span>· Save locked until approval</span></div>
        <button className="button secondary" disabled={runState !== 'saved' || exporting} onClick={exportDossier}>{exporting ? 'Preparing…' : 'Export dossier'}</button>
      </header>

      <div className="workspace">
        <section className="primary-column">
          <section className="hero-panel">
            <p className="hero-kicker">Human-controlled verification</p>
            <h1>Verify a public claim before it becomes permanent.</h1>
            <p className="hero-copy">Two opposing research angles surface the evidence. Deterministic date metadata breaks the tie. Nothing is saved until you approve it.</p>
            <div className="workflow-steps" aria-label="Verification progress">
              {workflowSteps.map((step, index) => {
                const number = index + 1
                const state = number < activeStep ? 'complete' : number === activeStep ? 'active' : 'upcoming'
                return <div className={`workflow-step ${state}`} key={step}><span>{number}</span><strong>{step}</strong></div>
              })}
            </div>
            <div className="section-heading"><span>1</span><div>Spoken brief<em>{runState === 'ready' ? 'Ready for a claim' : 'Brief captured'}</em></div></div>
            <div className="brief-input-wrap">
              <textarea aria-label="Brief to verify" value={brief} disabled={isBusy} onChange={(event) => { setBrief(event.target.value); setSpokenBrief('') }} />
              <div className="brief-actions">
                {voice.recognitionSupported && <button className="button secondary compact" disabled={isBusy} onClick={captureBrief}>{listeningFor === 'brief' ? 'Listening…' : 'Speak brief'}</button>}
                <button className="button primary compact" disabled={isBusy || !brief.trim()} onClick={runInvestigation}>{verifyButtonLabel}</button>
              </div>
            </div>
            <p className="input-meta">{voice.recognitionSupported ? 'Speak, confirm the transcript, or type your claim.' : 'Voice recognition is unavailable in this browser. Type your brief instead.'} <span>Demo uses pinned public Starbucks sources.</span></p>
          </section>

          <section className="panel timeline-panel">
            <div className="panel-heading-row">
              <div className="section-heading"><span>2</span><div>Investigation timeline<em>Two adversarial research angles</em></div></div>
              <div className={`stage-pill ${runState === 'running' ? 'active' : ''}`}>{runState === 'running' ? 'Researching' : result ? 'Complete' : 'Waiting'}</div>
            </div>
            <p className="section-intro">Evidence is kept in opposing lanes so a confident answer can never hide a public contradiction.</p>
            <div className="research-grid">
            {sourceGroups.map((group) => {
              const sources = findingsByAngle[group.key] ?? []
              return (
                <div className={`agent-lane ${group.tone}`} key={group.key}>
                  <div className="agent-label"><span>{group.key === 'current' ? 'Support angle' : 'Challenge angle'}</span><strong>{group.label}</strong><small>{group.description}</small></div>
                  <div className="source-stream">
                    {sources.length
                      ? sources.map((source) => <SourceCard source={source} key={source.url} />)
                      : <div className={`source-empty ${runState === 'running' ? 'active' : ''}`}><strong>{runState === 'running' ? 'Searching public sources' : 'No evidence collected yet'}</strong><span>{runState === 'running' ? 'Checking source claims and machine-readable dates…' : 'This lane activates when you verify the brief.'}</span></div>}
                  </div>
                </div>
              )
            })}
            </div>
            {hasConflict && <div className="conflict"><span className="conflict-label">Conflict</span><div><strong>Public sources disagree on the claim.</strong><p>The date-metadata resolver was invoked instead of silently choosing a source.</p></div><span>Escalated to resolver</span></div>}
          </section>

          <section className="panel resolver-panel">
            <div className="panel-heading-row">
              <div className="section-heading"><span>3</span><div>Date-metadata resolver<em>Deterministic evidence check</em></div></div>
              <div className={`stage-pill ${resolver?.status ?? ''}`}>{resolver ? resolver.status : 'Waiting'}</div>
            </div>
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
            <div className="approval-copy"><div className="section-heading"><span>4</span><div>Human approval<em>Server-enforced gate</em></div></div><h2>Save this verified brief?</h2><p>{approvalPrompt || 'Saving is blocked at the server until you explicitly decide.'}</p></div>
            <div className="approval-actions">
              {voice.recognitionSupported && <button className="button secondary" disabled={!awaitingApproval || isBusy} onClick={captureApproval}>{listeningFor === 'approval' ? 'Listening…' : 'Answer by voice'}</button>}
              <button className="button primary" disabled={!awaitingApproval || isBusy} onClick={() => decide(true)}>{runState === 'saving' ? 'Saving…' : 'Approve & save'}</button>
              <button className="button secondary" disabled={!awaitingApproval || isBusy} onClick={() => decide(false)}>Keep investigating</button>
            </div>
          </section>
          {notice && <p className={`notice ${runState === 'error' ? 'error' : ''}`} role={runState === 'error' ? 'alert' : 'status'}>{notice}</p>}
        </section>

        <aside className="dossier panel">
          <div className="dossier-header"><div><p>Decision dossier</p><h2>Evidence at a glance</h2></div><span className={dossierStatus.className}>{dossierBadge}</span></div>
          <section className="conclusion"><p>Overall conclusion</p><h1>{conclusion.title}</h1><p>{conclusion.text}</p></section>
          <section className="dossier-section">
            <p className="dossier-label">Evidence summary</p>
            {allSources.length
              ? allSources.map((source) => <div className="evidence-item" key={source.url}><span className={source.stance === 'supports' ? 'support-dot' : 'conflict-dot'} /><div><strong>{source.title}</strong><small>{sourceHost(source.url)}</small></div><em>{source.stance === 'supports' ? 'Supports' : 'Contradicts'}</em></div>)
              : <p className="empty-summary">No evidence collected yet.</p>}
          </section>
          <section className="dossier-section status-box"><p className="dossier-label">Persistence checkpoint</p><strong className={dossierStatus.className}>{dossierStatus.label}</strong><p>{dossierStatus.text}</p></section>
          <p className="privacy-note">The evidence stays inside this session until the approval checkpoint succeeds.</p>
        </aside>
      </div>
    </main>
  )
}
