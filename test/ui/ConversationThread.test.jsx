// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import ConversationThread from '../../src/components/ConversationThread.jsx';

afterEach(cleanup);

describe('ConversationThread', () => {
  it('renders chronological, labeled turns in an accessible live log', () => {
    render(<ConversationThread messages={[
      { id: '1', role: 'user', text: 'Which source is newer?' },
      { id: '2', role: 'assistant', text: 'The August source is newer.' },
    ]} />);

    const log = screen.getByRole('log', { name: /verification conversation/i });
    expect(log).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('The Verifier')).toBeTruthy();
    expect(screen.getByText('Which source is newer?')).toBeTruthy();
    expect(screen.getByText('The August source is newer.')).toBeTruthy();
  });

  it('announces processing without inventing an assistant message', () => {
    render(<ConversationThread messages={[]} busy />);
    expect(screen.getByText(/checking the active evidence/i)).toBeTruthy();
  });
});
