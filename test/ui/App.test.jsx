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
  it('captures a spoken brief and requires transcript confirmation before verification', async () => {
    const calls = [];
    const api = {
      runVerification: async ({ brief }) => {
        calls.push(brief);
        return workflow;
      },
      submitApproval: async () => { throw new Error('not used'); },
      getDossier: async () => { throw new Error('not used'); },
    };
    const voice = {
      recognitionSupported: true,
      listen: async () => 'Verify that Brian Niccol is CEO of Starbucks',
      speak: async () => {},
    };
    const user = userEvent.setup();
    render(<App api={api} voice={voice} />);

    await user.click(screen.getByRole('button', { name: /speak brief/i }));

    expect(await screen.findByText(/I heard:/i)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /brief to verify/i }).value).toBe(
      'Verify that Brian Niccol is CEO of Starbucks',
    );
    expect(calls).toEqual([]);

    await user.click(screen.getByRole('button', { name: /confirm & verify/i }));

    expect(calls).toEqual(['Verify that Brian Niccol is CEO of Starbucks']);
  });

  it('speaks the result and accepts an explicit voice approval', async () => {
    const decisions = [];
    const spoken = [];
    const api = {
      runVerification: async () => workflow,
      submitApproval: async (decision) => {
        decisions.push(decision);
        return {
          session: { id: sessionId, status: 'saved' },
          dossier: { id: sessionId },
        };
      },
      getDossier: async () => { throw new Error('not used'); },
    };
    const voice = {
      recognitionSupported: true,
      listen: async () => 'Yes, go ahead',
      speak: async (message) => { spoken.push(message); },
    };
    const user = userEvent.setup();
    render(<App api={api} voice={voice} />);

    await user.click(screen.getByRole('button', { name: /verify brief/i }));

    expect(await screen.findByText('Awaiting your approval')).toBeTruthy();
    expect(spoken.some((message) => message.includes('The Brian Niccol announcement has the newest strong date signal.'))).toBe(true);
    expect(spoken.some((message) => message.includes('Can I go ahead?'))).toBe(true);

    await user.click(screen.getByRole('button', { name: /answer by voice/i }));

    expect(decisions).toEqual([{
      sessionId,
      approvalToken: 'one-time-token',
      approved: true,
    }]);
    expect(await screen.findByText('Saved with approval')).toBeTruthy();
    expect(spoken.at(-1)).toBe('Saved.');
  });

  it('keeps typed verification and button approval available without speech recognition', async () => {
    const decisions = [];
    const api = {
      runVerification: async () => workflow,
      submitApproval: async (decision) => {
        decisions.push(decision);
        return {
          session: { id: sessionId, status: 'saved' },
          dossier: { id: sessionId },
        };
      },
      getDossier: async () => { throw new Error('not used'); },
    };
    const voice = {
      recognitionSupported: false,
      listen: async () => { throw new Error('Speech recognition unavailable'); },
      speak: async () => {},
    };
    const user = userEvent.setup();
    render(<App api={api} voice={voice} />);

    expect(screen.getByText(/Voice recognition is unavailable/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /speak brief/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /verify brief/i }));
    await user.click(await screen.findByRole('button', { name: /approve & save/i }));

    expect(decisions).toHaveLength(1);
    expect(decisions[0].approved).toBe(true);
    expect(await screen.findByText('Saved with approval')).toBeTruthy();
  });

  it('renders server findings and shows saved only after server approval', async () => {
    const api = {
      runVerification: async () => workflow,
      submitApproval: async () => ({
        session: { id: sessionId, status: 'saved' },
        dossier: { id: sessionId },
      }),
      getDossier: async () => ({
        id: sessionId,
        brief: 'Verify that Brian Niccol is CEO of Starbucks.',
        result: workflow.result,
        savedAt: '2026-08-29T12:00:00.000Z',
      }),
    };
    const saveJson = () => {};
    const user = userEvent.setup();
    render(<App api={api} saveJson={saveJson} />);

    expect(screen.getByRole('button', { name: /export dossier/i }).hasAttribute('disabled')).toBe(true);

    const brief = screen.getByRole('textbox', { name: /brief to verify/i });
    await user.clear(brief);
    await user.type(brief, 'Verify that Brian Niccol is CEO of Starbucks.');
    await user.click(screen.getByRole('button', { name: /verify brief/i }));

    expect((await screen.findAllByText('Starbucks names Brian Niccol as Chairman and CEO')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Northstar AI/i)).toBeNull();
    expect(screen.getByText('Awaiting your approval')).toBeTruthy();
    expect(screen.getByRole('button', { name: /export dossier/i }).hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: /approve & save/i }));

    expect(await screen.findByText('Saved with approval')).toBeTruthy();
    expect(screen.getAllByText(/server persisted the dossier/i).length).toBeGreaterThan(0);

    const exportButton = screen.getByRole('button', { name: /export dossier/i });
    expect(exportButton.hasAttribute('disabled')).toBe(false);
    await user.click(exportButton);
    expect(await screen.findByText(/dossier downloaded/i)).toBeTruthy();
  });

  it('shows a recoverable error when the workflow request fails', async () => {
    const api = {
      runVerification: async () => { throw new Error('Workflow execution failed'); },
      submitApproval: async () => { throw new Error('not used'); },
      getDossier: async () => { throw new Error('not used'); },
    };
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(screen.getByRole('button', { name: /verify brief/i }));

    expect(await screen.findByText(/Workflow execution failed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
