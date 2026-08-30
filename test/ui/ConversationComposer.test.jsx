// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConversationComposer from '../../src/components/ConversationComposer.jsx';

afterEach(cleanup);

describe('ConversationComposer', () => {
  it('sends typed follow-ups and exposes explicit research when required', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const onSend = vi.fn((event) => event.preventDefault());
    const onResearchAgain = vi.fn();
    render(<ConversationComposer
      draft="Why is that source newer?"
      onDraftChange={onDraftChange}
      onSend={onSend}
      onResearchAgain={onResearchAgain}
      requiresResearch
      voiceAvailable={false}
      voiceMode="off"
    />);

    await user.click(screen.getByRole('button', { name: /send follow-up/i }));
    await user.click(screen.getByRole('button', { name: /research again/i }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onResearchAgain).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: /message the verifier/i })).toBeTruthy();
  });

  it('switches from one start action to a persistent stop-listening action', async () => {
    const user = userEvent.setup();
    const onStopVoice = vi.fn();
    const { rerender } = render(<ConversationComposer
      draft=""
      onDraftChange={() => {}}
      onSend={() => {}}
      voiceAvailable
      voiceMode="off"
      onStartVoice={() => {}}
      onStopVoice={onStopVoice}
    />);
    expect(screen.getByRole('button', { name: /start voice conversation/i })).toBeTruthy();

    rerender(<ConversationComposer
      draft=""
      onDraftChange={() => {}}
      onSend={() => {}}
      voiceAvailable
      voiceMode="listening"
      onStartVoice={() => {}}
      onStopVoice={onStopVoice}
    />);
    await user.click(screen.getByRole('button', { name: /stop listening/i }));

    expect(onStopVoice).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /start voice conversation/i })).toBeNull();
  });
});
