import { test, expect } from '@playwright/test';

test('adds an assignment that survives a reload', async ({ page, request }) => {
  const { slug } = await (await request.post('/api/plans', { data: { name: 'Smoke' } })).json();

  await page.goto(`/${slug}`);
  const cells = page.locator('td[data-cell]');
  await expect(page.locator('input[value="Person 1"]')).toBeVisible();
  await expect(cells.first()).toBeVisible();

  await cells.first().click();
  await page.getByTitle('Mark this week as PTO (not a project)').click();
  await expect(cells.first()).toContainText('PTO');

  await expect
    .poll(async () => (await (await request.get(`/api/plans/${slug}`)).json()).state.assignments.length)
    .toBe(1);

  await page.reload();
  await expect(cells.first()).toContainText('PTO');
});
