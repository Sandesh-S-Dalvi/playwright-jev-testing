import { noul, choice, score } from '@typesafe-ai/sdk';
import { getJevClient } from './client.js';

export interface FailureContext {
  testTitle: string;
  errorMessage: string;
  stack?: string;
  statusCode?: number;
  responseBody?: string;
  requestUrl?: string;
  requestMethod?: string;
  pageUrl?: string;
  pageSnapshot?: string;
  retryCount?: number;
  durationMs?: number;
}

export interface FailureAnalysis {
  isFlake: boolean;
  flakeProbability: number;
  failureType: string;
  severity: number;
  canBeFixedInTest: boolean;
  recommendedAction: string;
  confidence: number;
  rationale: string;
  ticketSuggested: boolean;
}

/**
 * On test failure, ask Jev whether this is a flake, a genuine failure,
 * whether the test can be updated, or whether a ticket should be raised.
 *
 * All judgments are typed (noul / choice / score) and carry calibrated probabilities.
 */
export async function analyzeFailure(ctx: FailureContext): Promise<FailureAnalysis> {
  const client = getJevClient();

  const state = [
    `Test: ${ctx.testTitle}`,
    `Error: ${ctx.errorMessage}`,
    ctx.stack ? `Stack (excerpt): ${ctx.stack.slice(0, 800)}` : '',
    ctx.requestMethod && ctx.requestUrl ? `Request: ${ctx.requestMethod} ${ctx.requestUrl}` : '',
    ctx.statusCode !== undefined ? `Status: ${ctx.statusCode}` : '',
    ctx.responseBody ? `Response body (excerpt): ${ctx.responseBody.slice(0, 600)}` : '',
    ctx.pageUrl ? `Page URL: ${ctx.pageUrl}` : '',
    ctx.pageSnapshot ? `Page snapshot excerpt: ${ctx.pageSnapshot.slice(0, 800)}` : '',
    `Retries so far: ${ctx.retryCount ?? 0}`,
    ctx.durationMs ? `Duration: ${ctx.durationMs}ms` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await client.systemOne({
    state,
    questions: {
      is_flake: noul(
        'Is this failure likely a flake (transient, timing, network, race, or non-deterministic) rather than a stable product or test bug? Answer true only if evidence points to non-determinism or infrastructure noise.'
      ),
      failure_type: choice(
        'What is the primary nature of this failure?',
        {
          assertion: 'Hard assertion or expected value mismatch',
          selector: 'Element not found or locator changed',
          timeout: 'Timeout waiting for condition or response',
          http_error: 'HTTP status or API contract violation',
          data: 'Unexpected or missing data in response/body',
          environment: 'Environment, auth, rate-limit, or connectivity issue',
          other: 'Does not fit the above',
        }
      ),
      severity: score(
        'How severe is this failure for the system under test?',
        [
          'Minor (cosmetic or low-impact assertion)',
          'Moderate (feature partially broken)',
          'High (core flow broken)',
          'Critical (data loss, security, or total outage)',
        ]
      ),
      can_fix_in_test: noul(
        'Can this be resolved by updating the test (locator, assertion, wait, or data expectation) without a product change? Answer true only if the product behavior appears correct and the test is brittle or outdated.'
      ),
      action: choice(
        'What is the recommended next action?',
        {
          retry: 'Retry the test; likely transient',
          update_test: 'Update the test code (locator, assertion, or wait)',
          file_ticket: 'File a bug ticket; product defect',
          investigate: 'Needs more investigation before deciding',
        }
      ),
    },
  });

  const flakeProb = response.answers.is_flake.noul;
  const fixProb = response.answers.can_fix_in_test.noul;
  const action = response.answers.action.choice;
  const actionProb = response.answers.action.probabilities?.[action] ?? 0;
  const type = response.answers.failure_type.choice;
  const severity = response.answers.severity.score;

  const isFlake = flakeProb >= 0.7;
  const canBeFixedInTest = fixProb >= 0.7;
  const ticketSuggested = action === 'file_ticket' && actionProb >= 0.65;

  const rationale = [
    `Flake probability: ${flakeProb.toFixed(3)}`,
    `Failure type: ${type}`,
    `Severity score: ${severity.toFixed(2)}`,
    `Can fix in test: ${fixProb.toFixed(3)}`,
    `Recommended action: ${action} (p=${actionProb.toFixed(3)})`,
  ].join('; ');

  return {
    isFlake,
    flakeProbability: flakeProb,
    failureType: type,
    severity,
    canBeFixedInTest,
    recommendedAction: action,
    confidence: Math.min(flakeProb, fixProb, actionProb),
    rationale,
    ticketSuggested,
  };
}

/**
 * Format the analysis for console or report attachment.
 */
export function formatAnalysis(analysis: FailureAnalysis): string {
  return [
    '=== Jev Failure Analysis ===',
    `Flake: ${analysis.isFlake} (p=${analysis.flakeProbability.toFixed(3)})`,
    `Type: ${analysis.failureType}`,
    `Severity: ${analysis.severity.toFixed(2)}`,
    `Can fix in test: ${analysis.canBeFixedInTest}`,
    `Action: ${analysis.recommendedAction}`,
    `Ticket suggested: ${analysis.ticketSuggested}`,
    `Rationale: ${analysis.rationale}`,
    '============================',
  ].join('\n');
}
