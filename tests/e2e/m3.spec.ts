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

async function command(page: Page, name: string) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Search pages or type a command').fill(name.toLowerCase());
  await page.getByRole('option', { name }).click();
}

async function ensureProject(page: Page) {
  if (await page.getByRole('treeitem', { name: /^Project:/ }).count()) return;
  await command(page, 'New project');
  await page.getByLabel('Name', { exact: true }).fill(`Launch ${Date.now()}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/p\//);
}

async function pageMarkdown(page: Page) {
  return page.evaluate(async () => {
    const res = await fetch(location.pathname.replace('/w/', '/api/workspaces/').replace('/p/', '/pages/'));
    return ((await res.json()) as { page: { contentMd: string } }).page.contentMd;
  });
}

test('mindmap: type ideas with the keyboard, saved as an outline', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Keyboard flow; mobile covers the shell in smoke.spec');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await ensureProject(page);

  await command(page, 'New mindmap');
  await expect(page.getByRole('application', { name: /Mindmap/ })).toBeVisible();
  // A new mindmap starts by naming its central idea.
  const idea = page.getByLabel('Idea text');
  await expect(idea).toBeFocused();
  await page.keyboard.type('Q1 plan');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Growth');
  await page.keyboard.press('Tab');
  await page.keyboard.type('SEO audit');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Newsletter');
  await page.keyboard.press('Escape');

  await expect.poll(() => pageMarkdown(page), { timeout: 5_000 }).toBe('# Q1 plan\n\n- Growth\n  - SEO audit\n  - Newsletter\n');
  // The page takes its title from the central idea.
  await expect(page.getByLabel('Page title')).toHaveValue('Q1 plan');

  // Radial layout, then reload: the tree and layout stay.
  await page.getByRole('radio', { name: 'Radial' }).click();
  await page.waitForTimeout(1_200);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Radial' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.notey-mind-node', { hasText: 'Newsletter' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('canvas opens with its tools, and a doc draws a chart from pasted Markdown', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Desktop flow');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await ensureProject(page);

  await command(page, 'New canvas');
  await expect(page.getByRole('button', { name: 'Add sticky note' })).toBeVisible({ timeout: 15_000 });
  // Single-key tools belong to the canvas: T picks the text tool, not quick add.
  await page.locator('.excalidraw canvas').last().click({ position: { x: 300, y: 300 } });
  await page.keyboard.press('t');
  await expect(page.getByRole('dialog', { name: 'Add a task' })).toHaveCount(0);

  await command(page, 'New doc');
  await page.getByLabel('Page title').fill('Pipeline');
  await page.getByLabel('Page title').press('Enter');
  // The editor chunk may still be mounting on a fast runner: paste only once it's there.
  await expect(page.locator('.bn-editor')).toBeVisible();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '## Signups\n\n```chart\ntype: line\ntitle: Signups\nhighlight: 2026\n\nMonth,2025,2026\nJan,120,180\nFeb,140,210\n```\n');
    document.querySelector('.bn-editor')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('img', { name: /Signups: line chart of 2025, 2026 by Month/ })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => pageMarkdown(page), { timeout: 5_000 }).toContain('```chart\ntype: line');
  expect(errors).toEqual([]);
});
