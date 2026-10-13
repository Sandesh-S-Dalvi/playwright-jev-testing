import type { Page, Locator } from '@playwright/test';
import { noul, choice } from '@typesafe-ai/sdk';
import { getJevClient } from './client.js';
import { snapshotPage, type Control } from './snapshot.js';

const MIN_CONFIDENCE = 0.75;

/**
 * Semantic assertion: does the page satisfy the claim?
 * Uses noul (yes/no) with calibrated probability.
 */
export async function expectSemantic(
  page: Page,
  claim: string,
  minProbability = 0.85
): Promise<void> {
  const snap = await snapshotPage(page);
  const client = getJevClient();

  const response = await client.systemOne({
    state: snap.summary,
    questions: {
      holds: noul(
        `Does the current page satisfy this claim? Answer true only if the visible content and controls clearly support it. Claim: "${claim}"`
      ),
    },
  });

  const prob = response.answers.holds.noul;
  const confidence = response.answers.holds.confidence ?? prob;

  if (prob < minProbability || confidence < MIN_CONFIDENCE) {
    throw new Error(
      `Semantic assertion failed for claim: "${claim}". Probability=${prob.toFixed(3)}, confidence=${confidence.toFixed(3)}. Page: ${snap.url}`
    );
  }
}

/**
 * Pick the control that best matches the intent.
 * Returns a Playwright Locator for the chosen element.
 */
export async function pick(
  page: Page,
  intent: string,
  minProbability = 0.7
): Promise<{ locator: Locator; control: Control; probability: number }> {
  const snap = await snapshotPage(page);
  if (snap.controls.length === 0) {
    throw new Error(`No interactive controls found on ${snap.url} for intent: "${intent}"`);
  }

  const client = getJevClient();
  const criteria: Record<string, string> = {};
  snap.controls.forEach((c) => {
    criteria[`ctrl_${c.index}`] = `[${c.index}] ${c.role} "${c.name || c.text}"${c.type ? ` (${c.type})` : ''}`;
  });
  criteria['none'] = 'None of the listed controls match the intent';

  const response = await client.systemOne({
    state: `${snap.summary}\n\nIntent: ${intent}`,
    questions: {
      target: choice('Which control best matches the intent? Prefer the most specific match. Use none if none fit.', criteria),
    },
  });

  const chosen = response.answers.target.choice;
  const probs = response.answers.target.probabilities;
  const prob = probs?.[chosen] ?? 0;

  if (chosen === 'none' || prob < minProbability) {
    throw new Error(
      `Could not confidently pick a control for "${intent}". Chosen=${chosen}, prob=${prob.toFixed(3)}. Controls: ${snap.controls.length}`
    );
  }

  const index = parseInt(chosen.replace('ctrl_', ''), 10);
  const control = snap.controls.find((c) => c.index === index);
  if (!control) throw new Error(`Chosen control index ${index} not found`);

  // Reconstruct locator by re-querying with the same strategy (best-effort)
  const locator = page.locator(
    control.tag === 'input' || control.tag === 'textarea' || control.tag === 'select'
      ? `${control.tag}${control.type ? `[type="${control.type}"]` : ''}`
      : control.tag
  ).nth(index); // approximate; for production prefer data-testid or more robust matching

  // Prefer text or role-based if available
  const better = control.name
    ? page.getByRole(control.role as any, { name: control.name }).first()
    : control.text
    ? page.getByText(control.text, { exact: false }).first()
    : locator;

  return { locator: better, control, probability: prob };
}

/**
 * Goal-driven loop: Jev decides the next action toward a goal until DONE or max steps.
 * Actions are limited to observed controls.
 */
export async function runGoal(
  page: Page,
  goal: string,
  maxSteps = 8
): Promise<{ steps: number; done: boolean }> {
  const client = getJevClient();

  for (let step = 0; step < maxSteps; step++) {
    const snap = await snapshotPage(page);

    const criteria: Record<string, string> = {
      DONE: 'The goal is already achieved based on the page content',
      BLOCKED: 'Cannot progress (login wall, error, missing capability)',
    };
    snap.controls.forEach((c) => {
      criteria[`click_${c.index}`] = `Click [${c.index}] ${c.role} "${c.name || c.text}"`;
    });

    const response = await client.systemOne({
      state: `${snap.summary}\n\nGoal: ${goal}\nStep ${step + 1}/${maxSteps}`,
      questions: {
        next: choice(
          'What is the single best next action toward the goal? Choose DONE if already satisfied, BLOCKED if stuck, or one click_*.',
          criteria
        ),
      },
    });

    const action = response.answers.next.choice;
    const prob = response.answers.next.probabilities?.[action] ?? 0;

    if (action === 'DONE' && prob >= 0.8) {
      return { steps: step, done: true };
    }
    if (action === 'BLOCKED') {
      throw new Error(`Goal blocked at step ${step}: ${goal}. Prob=${prob}`);
    }
    if (action.startsWith('click_') && prob >= 0.65) {
      const index = parseInt(action.replace('click_', ''), 10);
      const control = snap.controls.find((c) => c.index === index);
      if (control) {
        const loc = page.getByRole(control.role as any, { name: control.name || undefined }).first();
        await loc.click({ timeout: 5000 }).catch(() => {
          // fallback click by text
          return page.getByText(control.text || control.name, { exact: false }).first().click({ timeout: 5000 });
        });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
    } else {
      throw new Error(`Uncertain next action: ${action} (p=${prob.toFixed(2)}) for goal "${goal}"`);
    }
  }

  return { steps: maxSteps, done: false };
}
