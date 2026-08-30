export default function ConversationComposer({
  draft,
  onDraftChange,
  onSend,
  onResearchAgain,
  requiresResearch = false,
  voiceAvailable = false,
  voiceMode = 'off',
  onStartVoice,
  onStopVoice,
  disabled = false,
}) {
  const voiceActive = voiceMode !== 'off';
  return (
    <form className="conversation-composer" onSubmit={onSend}>
      <label htmlFor="conversation-message">Message the verifier</label>
      <textarea
        id="conversation-message"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder="Ask which source is newer, why the verdict changed, or request fresh research…"
        rows={3}
        maxLength={2000}
        disabled={disabled}
      />
      <div className="conversation-composer-footer">
        <div className="conversation-actions">
          <button className="button primary" type="submit" disabled={disabled || !draft.trim()}>Send follow-up</button>
          {requiresResearch ? <button className="button secondary" type="button" onClick={onResearchAgain} disabled={disabled}>Research again</button> : null}
          {voiceAvailable ? (voiceActive
            ? <button className="button voice-stop" type="button" onClick={onStopVoice}>Stop listening</button>
            : <button className="button secondary" type="button" onClick={onStartVoice} disabled={disabled}>Start voice conversation</button>
          ) : null}
        </div>
        <span className={`voice-state ${voiceActive ? 'active' : ''}`} aria-live="polite">
          {voiceMode === 'listening' ? 'Listening for your next question' : null}
          {voiceMode === 'processing' ? 'Responding, then listening again' : null}
          {voiceMode === 'off' ? 'Typed follow-up is always available' : null}
        </span>
      </div>
    </form>
  );
}
