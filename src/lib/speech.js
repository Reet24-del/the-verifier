export function createBrowserVoice(browser = globalThis) {
  const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;

  return {
    recognitionSupported: typeof Recognition === 'function',

    listen() {
      if (typeof Recognition !== 'function') {
        return Promise.reject(new Error('Speech recognition is unavailable. Type your response instead.'));
      }

      return new Promise((resolve, reject) => {
        const recognition = new Recognition();
        let settled = false;
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          const transcript = event.results?.[0]?.[0]?.transcript?.trim();
          if (!transcript) return;
          settled = true;
          recognition.stop();
          resolve(transcript);
        };
        recognition.onerror = (event) => {
          settled = true;
          reject(new Error(event.error === 'not-allowed'
            ? 'Microphone access was denied. Type your response instead.'
            : 'I could not understand the audio. Please try again or type your response.'));
        };
        recognition.onend = () => {
          if (!settled) reject(new Error('No speech was detected. Please try again or type your response.'));
        };
        recognition.start();
      });
    },

    speak(message) {
      const SpeechUtterance = browser.SpeechSynthesisUtterance;
      if (!browser.speechSynthesis || typeof SpeechUtterance !== 'function') {
        return Promise.resolve(false);
      }

      browser.speechSynthesis.cancel();
      browser.speechSynthesis.speak(new SpeechUtterance(message));
      return Promise.resolve(true);
    },
  };
}

export function approvalDecisionFromTranscript(transcript) {
  const answer = transcript.trim().toLowerCase();
  if (/\b(no|reject|stop|keep investigating|do not|don't)\b/.test(answer)) return false;
  if (/\b(yes|approve|approved|confirm|save it|go ahead)\b/.test(answer)) return true;
  return null;
}

export function buildApprovalPrompt(result) {
  const resolution = result.resolution?.message
    ?? 'The available evidence does not establish a reliable resolution.';
  const evidence = (result.resolution?.evidence ?? [])
    .map((item) => `${item.title}: ${item.field} ${item.normalized ?? item.raw}`)
    .join('; ');
  const evidenceSummary = evidence
    ? `The metadata evidence is ${evidence}.`
    : 'The metadata evidence was insufficient to establish recency.';
  const opening = result.status === 'resolved'
    ? 'I completed the verification.'
    : 'I completed the verification, but the conflict remains unresolved.';
  return `${opening} ${result.summary} ${evidenceSummary} ${resolution} I'd like to save this as your brief. Can I go ahead?`;
}
