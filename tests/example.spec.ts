import { test, expect } from '@playwright/test';
import { expectSemantic, pick, runGoal } from '../src/jev/index.js';

/**
 * Example tests demonstrating Jev as the intelligence layer.
 * Requires TYPESAFE_API_KEY in .env
 *
 * These use example.com / a simple public page for demo.
 * Replace with your application under test.
 */

test.describe('Jev intelligence layer', () => {
  test('semantic assertion on example.com', async ({ page }) => {
    await page.goto('https://example.com');
    await expectSemantic(page, 'This is a simple example domain page with a heading about example');
  });

  test('pick and interact with a control', async ({ page }) => {
    await page.goto('https://example.com');
    // On example.com the main link is "More information..."
    const { locator, probability } = await pick(page, 'the link that leads to more information about the example domain');
    console.log(`Picked control with probability ${probability.toFixed(3)}`);
    await locator.click();
    await expect(page).toHaveURL(/iana\.org/);
  });

  test('goal-driven navigation (short)', async ({ page }) => {
    await page.goto('https://example.com');
    const result = await runGoal(page, 'Navigate to the IANA page about example domains', 3);
    expect(result.done || result.steps > 0).toBeTruthy();
  });
});
