import { useCallback, useEffect, useRef, useState } from 'react';

import { isFatalSpeechError } from '../lib/speech.js';

export function useVoiceConversation({ voice, onTranscript, onFatalError, busy = false }) {
  const [mode, setMode] = useState('off');
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const runningRef = useRef(false);
  const retryRef = useRef(0);
  const busyRef = useRef(busy);
  const callbacksRef = useRef({ onTranscript, onFatalError });
  const pumpRef = useRef(null);

  callbacksRef.current = { onTranscript, onFatalError };
  busyRef.current = busy;

  const stop = useCallback(() => {
    activeRef.current = false;
    generationRef.current += 1;
    retryRef.current = 0;
    setMode('off');
  }, []);

  pumpRef.current = async (generation) => {
    if (!activeRef.current || generation !== generationRef.current || runningRef.current) return;
    if (busyRef.current) {
      setMode('processing');
      return;
    }

    runningRef.current = true;
    setMode('listening');
    try {
      const transcript = await voice.listen();
      if (!activeRef.current || generation !== generationRef.current) return;

      retryRef.current = 0;
      setMode('processing');
      await callbacksRef.current.onTranscript(transcript);
      if (!activeRef.current || generation !== generationRef.current) return;

      runningRef.current = false;
      queueMicrotask(() => pumpRef.current?.(generation));
    } catch (error) {
      if (!activeRef.current || generation !== generationRef.current) return;
      runningRef.current = false;

      if (!isFatalSpeechError(error) && retryRef.current < 1) {
        retryRef.current += 1;
        queueMicrotask(() => pumpRef.current?.(generation));
        return;
      }

      activeRef.current = false;
      setMode('off');
      callbacksRef.current.onFatalError?.(error);
    } finally {
      if (!activeRef.current || generation !== generationRef.current) {
        runningRef.current = false;
      }
    }
  };

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    retryRef.current = 0;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    pumpRef.current?.(generation);
  }, []);

  useEffect(() => {
    if (activeRef.current && !busy && !runningRef.current) {
      pumpRef.current?.(generationRef.current);
    }
  }, [busy]);

  useEffect(() => stop, [stop]);

  return { mode, start, stop, active: mode !== 'off' };
}
