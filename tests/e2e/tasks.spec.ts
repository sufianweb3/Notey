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
  await expect(page.getByRole('button', { name: /Search/ }).first()).toBeVisible();
}

test('tasks: quick add with natural language, repeat completes to the next date, pin to Important', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Desktop flow; mobile covers the shell in smoke.spec');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  const ws = page.url().match(/\/w\/([^/?]+)/)![1];
  await page.goto(`/w/${ws}/tasks?view=inbox`);

  // Quick add shows what it understood before Enter.
  const suffix = Date.now().toString(36);
  const add = page.getByLabel('Add a task');
  await add.click();
  await add.fill(`Call Rafi ${suffix} tomorrow 3pm`);
  await expect(page.getByText(`“Call Rafi ${suffix}”`)).toBeVisible();
  await add.press('Enter');
  const call = page.getByRole('listitem').filter({ hasText: `Call Rafi ${suffix}` });
  await expect(call).toContainText('Tomorrow');
  await expect(add).toHaveValue('');

  // A repeating task rolls to its next date when completed, with Undo.
  await add.fill(`Water plants ${suffix} every day`);
  await add.press('Enter');
  const water = page.getByRole('listitem').filter({ hasText: `Water plants ${suffix}` });
  await expect(water).toContainText('Daily');
  await water.getByRole('checkbox', { name: `Complete: Water plants ${suffix}` }).click();
  await expect(page.getByText('Done. Next: Tomorrow')).toBeVisible();
  await expect(water).toContainText('Tomorrow');

  // Pin from the row, then find it in Important.
  await call.hover();
  await call.getByRole('button', { name: `Pin Call Rafi ${suffix}` }).click();
  await expect(page.getByText('Pinned to Important')).toBeVisible();
  await page.goto(`/w/${ws}/important`);
  await expect(page.getByText(`Call Rafi ${suffix}`)).toBeVisible();

  expect(errors).toEqual([]);
});
