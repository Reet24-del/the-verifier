// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import App from '../../src/App.jsx';

const sessionId = '11111111-1111-4111-8111-111111111111';
const workflow = {
  session: { id: sessionId, status: 'awaiting_approval' },
  approvalToken: 'one-time-token',
  result: {
    mode: 'fixture',
    status: 'resolved',
    summary: 'Conflicting public sources were found.',
    findings: [
      {
        angle: 'current',
        sources: [{
          title: 'Starbucks names Brian Niccol as Chairman and CEO',
          url: 'https://about.starbucks.com/current',
          claim: 'Brian Niccol was named CEO.',
          stance: 'supports',
        }],
      },
      {
        angle: 'contradiction',
        sources: [{
          title: 'Starbucks reports Q3 fiscal 2024 results',
          url: 'https://about.starbucks.com/older',
          claim: 'Laxman Narasimhan was identified as CEO.',
          stance: 'contradicts',
        }],
      },
    ],
    resolution: {
      status: 'resolved',
      message: 'The Brian Niccol announcement has the newest strong date signal.',
      evidence: [
        {
          title: 'Starbucks names Brian Niccol as Chairman and CEO',
          url: 'https://about.starbucks.com/current',
          field: 'datePublished',
          raw: '2024-08-13T00:00:00Z',
          normalized: '2024-08-13T00:00:00.000Z',
        },
        {
          title: 'Starbucks reports Q3 fiscal 2024 results',
          url: 'https://about.starbucks.com/older',
          field: 'datePublished',
          raw: '2024-07-30T00:00:00Z',
          normalized: '2024-07-30T00:00:00.000Z',
        },
      ],
    },
  },
};

afterEach(cleanup);

describe('The Verifier workflow', () => {
  it('renders server findings and shows saved only after server approval', async () => {
    const api = {
      runVerification: async () => workflow,
      submitApproval: async () => ({
        session: { id: sessionId, status: 'saved' },
        dossier: { id: sessionId },
      }),
    };
    const user = userEvent.setup();
    render(<App api={api} />);

    const brief = screen.getByRole('textbox', { name: /brief to verify/i });
    await user.clear(brief);
    await user.type(brief, 'Verify that Brian Niccol is CEO of Starbucks.');
    await user.click(screen.getByRole('button', { name: /verify brief/i }));

    expect((await screen.findAllByText('Starbucks names Brian Niccol as Chairman and CEO')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Northstar AI/i)).toBeNull();
    expect(screen.getByText('Awaiting your approval')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /approve & save/i }));

    expect(await screen.findByText('Saved with approval')).toBeTruthy();
    expect(screen.getAllByText(/server persisted the dossier/i).length).toBeGreaterThan(0);
  });

  it('shows a recoverable error when the workflow request fails', async () => {
    const api = {
      runVerification: async () => { throw new Error('Workflow execution failed'); },
      submitApproval: async () => { throw new Error('not used'); },
    };
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(screen.getByRole('button', { name: /verify brief/i }));

    expect(await screen.findByText(/Workflow execution failed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
