// R8: what the user sees is true. One real run through the deployed stack, from submit to stored result.
import { AssessmentStatus, DomainsResponseSchema, LIVE_STATUSES, RunViewSchema } from '@novee/contracts';
import { expect, type Page, test } from '@playwright/test';
import { RUN_STATUS_LABEL } from '../src/lib/labels';

const TERMINAL_LABELS = Object.values(AssessmentStatus)
  .filter((status) => !LIVE_STATUSES.includes(status))
  .map((status) => RUN_STATUS_LABEL[status]);

const statusText = (page: Page) => page.getByTestId('run-status').textContent();

/**
 * The page against the source of truth: read the run and its domains straight from the API and check the screen
 * shows the same. Called only at stable moments (awaiting a decision, finished), so nothing moves in between.
 */
async function expectPageMatchesApi(page: Page, runId: string): Promise<void> {
  const run = RunViewSchema.parse(await (await page.request.get(`/api/assessments/${runId}`)).json());
  const domains = DomainsResponseSchema.parse(
    await (await page.request.get(`/api/assessments/${runId}/domains`)).json(),
  );

  await expect(page.getByTestId('run-status')).toHaveText(RUN_STATUS_LABEL[run.status]);
  await expect(page.getByTestId('run-counts')).toContainText(
    `${run.counts.completed} of ${run.agentCount} completed, ${run.counts.running} running, ${run.counts.queued} queued`,
  );
  if (run.summary !== null) {
    await expect(page.getByTestId('run-summary')).toContainText(
      `${run.summary.uniqueDomains} unique subdomains`,
    );
  }
  await expect(page.getByTestId('domain-list').locator('tbody tr')).toHaveCount(domains.domains.length);
}

test('submit, watch, approve, completed: truthful status, buttons from allowedActions, no polling after the end', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  let runPolls = 0;
  page.on('request', (request) => {
    if (/\/api\/assessments\/[0-9a-f-]{36}$/.test(request.url())) runPolls += 1;
  });

  await page.goto('/');
  await page.getByLabel('Domain').fill(`r8-${Date.now()}.com`);
  await page.getByLabel('Agents').fill('3');
  await page.getByLabel('Window').fill('2');
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  const runId = page.url().split('/').at(-1) ?? '';

  // Watch until it waits for a decision. It must never look finished before that.
  const seen: string[] = [];
  let checkedRunningButtons = false;
  for (;;) {
    const text = (await statusText(page)) ?? '';
    if (seen.at(-1) !== text) seen.push(text);
    expect(TERMINAL_LABELS, `showed "${text}" before any decision`).not.toContain(text);
    if (text === RUN_STATUS_LABEL[AssessmentStatus.Running] && !checkedRunningButtons) {
      await expect(page.getByTestId('action-approve')).toBeDisabled();
      await expect(page.getByTestId('action-cancel')).toBeEnabled();
      checkedRunningButtons = true;
    }
    if (text === RUN_STATUS_LABEL[AssessmentStatus.AwaitingApproval]) break;
    await page.waitForTimeout(250);
  }
  expect(checkedRunningButtons).toBe(true);

  // Awaiting approval: approve offered, cancel still offered, the window no longer changeable.
  await expect(page.getByTestId('action-approve')).toBeEnabled();
  await expect(page.getByTestId('action-cancel')).toBeEnabled();
  await expect(page.getByTestId('action-window')).toBeDisabled();
  await expect(page.getByTestId('domain-list')).toBeVisible();
  await expect(page.getByText('found, not stored yet')).toBeVisible();
  await expectPageMatchesApi(page, runId);

  await page.getByTestId('action-approve').click();
  await expect(page.locator('.errors')).toHaveCount(0); // the request itself was accepted
  await expect(page.getByTestId('run-status')).toHaveText(RUN_STATUS_LABEL[AssessmentStatus.Completed], {
    timeout: 60_000,
  });
  await expect(page.getByText(/stored\)/)).toBeVisible();
  await expect(page.getByTestId('action-approve')).toHaveCount(0); // no actions left to offer
  await expectPageMatchesApi(page, runId);

  // Finished: the page stops polling.
  const pollsAtEnd = runPolls;
  await page.waitForTimeout(6_000);
  expect(runPolls, 'polled the run after it ended').toBe(pollsAtEnd);

  expect(seen).toContain(RUN_STATUS_LABEL[AssessmentStatus.Running]);
  expect(errors).toEqual([]);
  await expect(page.getByTestId('contract-mismatch')).toHaveCount(0);
});
