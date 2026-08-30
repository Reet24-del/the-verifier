// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVoiceConversation } from '../../src/hooks/useVoiceConversation.js';

afterEach(() => vi.restoreAllMocks());

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useVoiceConversation', () => {
  it('keeps listening after each completed conversational turn', async () => {
    const first = deferred();
    const second = deferred();
    const voice = { listen: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
    const onTranscript = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useVoiceConversation({ voice, onTranscript }));

    act(() => result.current.start());
    expect(result.current.mode).toBe('listening');
    await act(async () => first.resolve('Which source is newer?'));

    await waitFor(() => expect(voice.listen).toHaveBeenCalledTimes(2));
    expect(onTranscript).toHaveBeenCalledWith('Which source is newer?');
    expect(result.current.mode).toBe('listening');
    act(() => result.current.stop());
  });

  it('does not process or re-arm a capture after the user stops', async () => {
    const capture = deferred();
    const voice = { listen: vi.fn().mockReturnValue(capture.promise) };
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({ voice, onTranscript }));

    act(() => result.current.start());
    act(() => result.current.stop());
    await act(async () => capture.resolve('Ignore this stale turn'));

    expect(result.current.mode).toBe('off');
    expect(onTranscript).not.toHaveBeenCalled();
    expect(voice.listen).toHaveBeenCalledTimes(1);
  });

  it('stops and surfaces fatal recognition failures', async () => {
    const error = Object.assign(new Error('Microphone permission is blocked.'), { code: 'speech-permission-blocked' });
    const voice = { listen: vi.fn().mockRejectedValue(error) };
    const onFatalError = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({ voice, onTranscript: vi.fn(), onFatalError }));

    await act(async () => result.current.start());

    await waitFor(() => expect(onFatalError).toHaveBeenCalledWith(error));
    expect(result.current.mode).toBe('off');
    expect(voice.listen).toHaveBeenCalledTimes(1);
  });
});
