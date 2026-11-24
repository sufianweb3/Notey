import { expect, test, type Page } from '@playwright/test';
import { ownAddress } from './ip';

const OWNER = { name: 'Nadia Rahman', email: 'nadia@example.com', password: 'correct horse battery' };

async function signIn(page: Page) {
  await ownAddress(page);
  await page.goto('/');
  await page.waitForURL(/\/(setup|login|w\/)/);
  if (page.url().includes('/setup')) {
    await page.getByLabel('Your name').fill(OWNER.name);
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel('Password').fill(OWNER.password);
    await page.getByRole('button', { name: 'Create account' }).click();
  } else if (page.url().includes('/login')) {
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel('Password').fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page).toHaveURL(/\/w\//);
}

test('AI access: create a token, an agent writes with it, the page says who edited it', async ({ page, request }, info) => {
  test.skip(info.project.name === 'mobile', 'Desktop flow');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);

  await page.goto('/settings/ai-access');
  await expect(page.getByRole('heading', { name: 'AI access', level: 1 })).toBeVisible();
  const name = `Script ${Date.now().toString(36)}`;
  await page.getByRole('button', { name: 'New token' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create token' }).click();
  const dialog = page.getByRole('dialog', { name: `Token for ${name}` });
  const secret = (await dialog.locator('code').first().textContent())!.trim();
  expect(secret).toMatch(/^ntk_/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(name)).toBeVisible();

  // The agent's side: REST v1 with the bearer token.
  const auth = { authorization: `Bearer ${secret}` };
  const wsId = (await (await request.get('/api/v1/workspace', { headers: auth })).json()).workspace.id as string;
  const tree = await (await request.get('/api/v1/tree', { headers: auth })).json();
  // The agent writes into an existing project; make one with the owner session if there's none.
  const projectId =
    (tree.projects[0]?.id as string | undefined) ??
    ((await (await page.request.post(`/api/workspaces/${wsId}/projects`, { data: { name: 'Launch' } })).json()).project.id as string);
  const made = await request.post('/api/v1/pages', { headers: auth, data: { projectId, title: 'Agent notes', markdown: '## Summary\n\nWritten by a script.' } });
  expect(made.status()).toBe(200);
  const pageId = (await made.json()).page.id as string;

  await page.goto(`/w/${wsId}/p/${pageId}`);
  await expect(page.getByText(`Edited by ${name}`)).toBeVisible();
  await expect(page.locator('.bn-editor')).toContainText('Written by a script.');

  // Revoke: the token stops working at once.
  await page.goto('/settings/ai-access');
  await page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('button', { name: 'Revoke token' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
  expect((await request.get('/api/v1/tree', { headers: auth })).status()).toBe(401);
  expect(errors).toEqual([]);
});
