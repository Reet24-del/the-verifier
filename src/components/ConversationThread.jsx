export default function ConversationThread({ messages = [], busy = false }) {
  return (
    <section className="conversation-panel" aria-labelledby="conversation-title">
      <div className="conversation-heading">
        <div>
          <p className="conversation-eyebrow">Evidence-grounded chat</p>
          <h2 id="conversation-title">Continue the investigation</h2>
        </div>
        <span className="conversation-memory">Context stays active</span>
      </div>
      <div className="conversation-thread" role="log" aria-label="Verification conversation" aria-live="polite">
        {messages.length === 0 ? (
          <div className="conversation-empty">
            <strong>Ask about the evidence</strong>
            <span>Your follow-ups will use the active sources and date metadata.</span>
          </div>
        ) : messages.map((message) => (
          <article className={`conversation-message ${message.role === 'user' ? 'user' : 'assistant'}`} key={message.id}>
            <span>{message.role === 'user' ? 'You' : 'The Verifier'}</span>
            <p>{message.text}</p>
          </article>
        ))}
        {busy ? (
          <article className="conversation-message assistant processing" aria-label="The Verifier is responding">
            <span>The Verifier</span>
            <p>Checking the active evidence<span className="processing-dots" aria-hidden="true">…</span></p>
          </article>
        ) : null}
      </div>
    </section>
  );
}
