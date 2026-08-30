import assert from 'node:assert/strict';
import test from 'node:test';

import { approvalDecisionFromTranscript, buildApprovalPrompt, createBrowserVoice } from '../src/lib/speech.js';

test('approval transcript accepts clear decisions and rejects ambiguous speech', () => {
  assert.equal(approvalDecisionFromTranscript('Yes, go ahead'), true);
  assert.equal(approvalDecisionFromTranscript("No, don't save it"), false);
  assert.equal(approvalDecisionFromTranscript('This is not approved'), false);
  assert.equal(approvalDecisionFromTranscript('I can\'t approve this'), false);
  assert.equal(approvalDecisionFromTranscript('Never go ahead'), false);
  assert.equal(approvalDecisionFromTranscript('Tell me more about the evidence'), null);
});

test('approval prompt includes the result, evidence resolution, and save question', () => {
  const prompt = buildApprovalPrompt({
    status: 'resolved',
    summary: 'Two Starbucks sources conflict.',
    resolution: {
      message: 'The August announcement is newer.',
      evidence: [
        { title: 'CEO announcement', field: 'datePublished', normalized: '2024-08-13T00:00:00.000Z' },
        { title: 'Q3 results', field: 'datePublished', normalized: '2024-07-30T00:00:00.000Z' },
      ],
    },
  });

  assert.equal(
    prompt,
    "I completed the verification. Two Starbucks sources conflict. The metadata evidence is CEO announcement: datePublished 2024-08-13T00:00:00.000Z; Q3 results: datePublished 2024-07-30T00:00:00.000Z. The August announcement is newer. I'd like to save this as your brief. Can I go ahead?",
  );
});

test('browser voice captures the final transcript and configures one-shot English recognition', async () => {
  let recognition;
  class Recognition {
    constructor() { recognition = this; }
    start() {
      queueMicrotask(() => this.onresult({ results: [[{ transcript: '  Verify the CEO  ' }]] }));
    }
    stop() {}
  }
  const voice = createBrowserVoice({ SpeechRecognition: Recognition });

  const transcript = await voice.listen();

  assert.equal(transcript, 'Verify the CEO');
  assert.equal(recognition.continuous, false);
  assert.equal(recognition.interimResults, false);
  assert.equal(recognition.lang, 'en-US');
});

test('browser voice resolves narration only after speech synthesis ends', async () => {
  let utterance;
  class SpeechUtterance {
    constructor(message) { this.message = message; utterance = this; }
  }
  const voice = createBrowserVoice({
    SpeechSynthesisUtterance: SpeechUtterance,
    speechSynthesis: { cancel() {}, speak() {} },
  });

  let finished = false;
  const speaking = voice.speak('Approval prompt').then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);

  utterance.onend();
  await speaking;
  assert.equal(finished, true);
});
