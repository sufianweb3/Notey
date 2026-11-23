import { expect, test, type Page } from '@playwright/test';

const OWNER = { name: 'Nadia Rahman', email: 'nadia@example.com', password: 'correct horse battery' };

/** First project to run creates the owner; later ones sign in. */
async function signInOrSetup(page: Page) {
  await page.goto('/');
  await page.waitForURL(/\/(setup|login|w\/)/);
  if (page.url().includes('/setup')) {
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
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

test('owner setup, workspace lifecycle, sign out and back in', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await signInOrSetup(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), Nadia/);

  // Create
  const name = `Client ${info.project.name}`;
  await page.goto('/settings/workspaces');
  await page.getByRole('button', { name: 'New workspace' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+$/);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(name);

  // Rename and set an icon
  const renamed = `${name} renamed`;
  await page.goto('/settings/workspaces');
  await page.getByRole('button', { name: `More for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Edit name and icon' }).click();
  await page.getByLabel('Name', { exact: true }).fill(renamed);
  await page.getByLabel('Icon').fill('🧪');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: `More for ${renamed}` })).toBeVisible();

  // Delete needs the exact name; then restore from trash
  await page.getByRole('button', { name: `More for ${renamed}` }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const confirm = page.getByRole('button', { name: 'Delete workspace' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(`Type ${renamed} to confirm`).fill(renamed);
  await confirm.click();
  const trashed = page.getByRole('listitem').filter({ hasText: renamed });
  await expect(trashed.getByRole('button', { name: 'Restore' })).toBeVisible();
  await trashed.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('button', { name: `More for ${renamed}` })).toBeVisible();

  // Sign out, protected page bounces to sign-in, sign back in returns there
  await page.getByRole('button', { name: /Switch workspace/ }).filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/settings/workspaces');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/settings\/workspaces$/);

  expect(errors).toEqual([]);
});

test('sign-up stays closed and health reports migrations', async ({ request }) => {
  const health = await request.get('/api/health');
  expect((await health.json()).migrations).toBeGreaterThanOrEqual(3);
  const signUp = await request.post('/api/auth/sign-up/email', {
    data: { name: 'Mallory', email: 'mallory@example.com', password: 'mallory-password-1' },
  });
  expect(signUp.status()).toBe(403);
});
