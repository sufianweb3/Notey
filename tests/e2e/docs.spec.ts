import { expect, test, type Page } from '@playwright/test';

const OWNER = { name: 'Nadia Rahman', email: 'nadia@example.com', password: 'correct horse battery' };

async function signIn(page: Page) {
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
  // The shell (and its keyboard shortcuts) is ready once the sidebar's Search button shows.
  await expect(page.getByRole('button', { name: /Search/ }).first()).toBeVisible();
}

test('write a doc: create, autosave, paste Markdown, search, trash and restore', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Desktop flow; mobile covers the shell in smoke.spec');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);

  // New doc from the command menu; with no project yet it asks for one first.
  const project = `Launch ${Date.now()}`;
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('option', { name: 'New project' }).click();
  await page.getByLabel('Name', { exact: true }).fill(project);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/p\//);

  // Title, then Enter moves into the editor.
  const title = page.getByLabel('Page title');
  await title.fill('Homepage brief');
  await title.press('Enter');
  await page.keyboard.type('Ship the new hero in December.');
  await expect(page.getByRole('treeitem', { name: 'Page: Homepage brief' })).toBeVisible();

  // Paste Markdown from an AI chat: it becomes native blocks.
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '## Checklist\n\n- [ ] Draft copy\n- [x] Pick photos\n\n| Plan | Price |\n|---|---:|\n| Pro | $12 |\n');
    document.querySelector('.bn-editor')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.bn-editor h2', { hasText: 'Checklist' })).toBeVisible();
  await expect(page.locator('.bn-editor table')).toBeVisible();
  await expect(page.locator('.bn-editor')).not.toContainText('##');

  // Autosave (600 ms debounce), then a reload shows the same content.
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByLabel('Page title')).toHaveValue('Homepage brief');
  await expect(page.locator('.bn-editor')).toContainText('Ship the new hero in December.');
  await expect(page.locator('.bn-editor h2', { hasText: 'Checklist' })).toBeVisible();

  // Search finds it by a word in the body.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Search pages or type a command').fill('decemb');
  await expect(page.getByRole('option', { name: /Homepage brief/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Trash from the tree's menu, then restore from Trash.
  await page.getByRole('treeitem', { name: 'Page: Homepage brief' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect(page.getByRole('treeitem', { name: 'Page: Homepage brief' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Trash' }).click();
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await expect(page.getByRole('treeitem', { name: 'Page: Homepage brief' })).toBeVisible();

  expect(errors).toEqual([]);
});
