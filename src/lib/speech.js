export function createBrowserVoice(browser = globalThis) {
  const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;

  return {
    recognitionSupported: typeof Recognition === 'function',

    async listen() {
      if (typeof Recognition !== 'function') {
        throw new Error('Speech recognition is unavailable. Type your response instead.');
      }

      const getUserMedia = browser.navigator?.mediaDevices?.getUserMedia;
      if (typeof getUserMedia === 'function') {
        try {
          const stream = await getUserMedia.call(browser.navigator.mediaDevices, { audio: true });
          stream.getTracks().forEach((track) => track.stop());
        } catch (error) {
          const blocked = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
          const voiceError = new Error(blocked
            ? 'Microphone permission is blocked. Allow microphone access for this site, then try again or type your brief.'
            : 'The microphone could not be opened. Check your input device, then try again or type your brief.');
          voiceError.code = blocked ? 'speech-permission-blocked' : 'speech-audio-unavailable';
          throw voiceError;
        }
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
          const messages = {
            'not-allowed': 'Microphone permission is blocked. Allow microphone access for this site, then try again or type your brief.',
            'service-not-allowed': 'Microphone permission is blocked. Allow microphone access for this site, then try again or type your brief.',
            'audio-capture': 'No working microphone was detected. Check your input device, then try again or type your brief.',
            network: 'Browser speech recognition is unavailable right now. Type your brief instead or try Chrome/Safari.',
            aborted: 'Speech capture stopped. Try again or type your brief.',
          };
          const error = new Error(messages[event.error]
            ?? 'I could not understand the audio. Please try again or type your response.');
          const errorCodes = {
            'not-allowed': 'speech-permission-blocked',
            'service-not-allowed': 'speech-permission-blocked',
            'audio-capture': 'speech-audio-unavailable',
            network: 'speech-service-unavailable',
            aborted: 'speech-aborted',
          };
          error.code = errorCodes[event.error] ?? 'speech-not-understood';
          reject(error);
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

      return new Promise((resolve) => {
        const utterance = new SpeechUtterance(message);
        const schedule = typeof browser.setTimeout === 'function'
          ? browser.setTimeout.bind(browser)
          : globalThis.setTimeout.bind(globalThis);
        const cancelSchedule = typeof browser.clearTimeout === 'function'
          ? browser.clearTimeout.bind(browser)
          : globalThis.clearTimeout.bind(globalThis);
        let settled = false;
        let timeout;
        const finish = (spoken) => {
          if (settled) return;
          settled = true;
          cancelSchedule(timeout);
          resolve(spoken);
        };
        utterance.onend = () => finish(true);
        utterance.onerror = () => finish(false);
        timeout = schedule(() => finish(false), 8000);
        browser.speechSynthesis.cancel();
        browser.speechSynthesis.speak(utterance);
      });
    },
  };
}

export function isFatalSpeechError(error) {
  return [
    'speech-permission-blocked',
    'speech-audio-unavailable',
    'speech-service-unavailable',
  ].includes(error?.code);
}

export function approvalDecisionFromTranscript(transcript) {
  const answer = transcript.trim().toLowerCase();
  if (/\b(no|not|never|reject|stop|keep investigating|do not|don't|cannot|can't|won't|wouldn't|shouldn't|couldn't)\b/.test(answer)) return false;
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
