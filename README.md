# Playwright + Jev Intelligence Layer

A production-oriented Playwright TypeScript project that uses **TypeSafe Jev** (System One model) as the intelligence layer.

Jev does not generate text or invent selectors. It answers typed questions (noul / choice / score) against a code-built page snapshot and returns calibrated probabilities. Playwright owns navigation, typing, waiting, screenshots, and traces.

This matches the "jev engineering" pattern: Claude/LLMs (or humans) write the tests and requirements; Jev handles the narrow judgment calls that would otherwise be brittle or expensive.

## Architecture

```
Playwright (code)          Jev (model)
─────────────────          ───────────
Navigate, click, type      Semantic assertions (noul)
Wait, screenshot, trace    Element picking by intent (choice)
Hard assertions            Goal-driven next-action (choice)
API requests               Failure classification (flake / type / severity / action)
                           Confidence thresholds in code
```

## Setup

1. Node.js 20+.

2. Install dependencies and browsers:

```bash
cd playwright-jev-testing
npm install
npx playwright install chromium
```

3. Get a TypeSafe API key from [typesafe.ai](https://typesafe.ai) / console.

4. Copy the env example and add your key:

```bash
cp .env.example .env
# edit .env and set TYPESAFE_API_KEY=sk-...
```

5. Run tests:

```bash
npm test
# or
npm run test:headed
```

## Key primitives

Located in `src/jev/`:

- `snapshotPage(page)` — builds a compact text state (URL, title, visible text, indexed controls).
- `expectSemantic(page, claim, minProbability?)` — noul question: does the page satisfy the claim?
- `pick(page, intent)` — choice among observed controls; returns a Locator + probability.
- `runGoal(page, goal, maxSteps?)` — loop that asks Jev for the next click until DONE or blocked.
- `analyzeFailure(ctx)` — on test failure, classifies flake vs genuine, type, severity, and recommended action (retry / update_test / file_ticket / investigate). Returns calibrated probabilities.

All decisions use the official `@typesafe-ai/sdk`. Model defaults to `jev-latest`; pin with `TYPESAFE_DEFAULT_MODEL=jev-1.13.0`.

## Failure intelligence (Petstore example)

`tests/petstore.spec.ts` exercises the public Petstore API (`https://petstore3.swagger.io/api/v3`).

An `afterEach` hook captures failure context (error, status, body, URL) and calls `analyzeFailure`. The analysis is printed and attached to the Playwright report as `jev-failure-analysis`.

Typical questions Jev answers:
- Is this a flake? (noul)
- Failure type (assertion / selector / timeout / http_error / data / environment)
- Severity (score)
- Can it be fixed in the test? (noul)
- Recommended action (retry / update_test / file_ticket / investigate)

Thresholds (0.65–0.7) live in code so low-confidence cases escalate to investigation.

## Extending

- Prefer data-testid / role locators in production; the pick/runGoal helpers fall back to text/role.
- Add score questions for ranking severity, similarity, or test selection.
- Wrap safety gates (e.g., "is this command destructive?") around tool use if you drive agents.
- Combine with a planner LLM only for free-text generation (form values, plans); keep every judgment in Jev.

## Cost & speed

Jev is ~100–300 ms and ~$0.042 / million input tokens with free output. A full overnight agent loop that previously burned frontier model turns on yes/no questions becomes cheap enough to leave running.

## References

- [TypeSafe / Jev](https://typesafe.ai)
- [API docs](https://docs.typesafe.ai/api)
- [SDK](https://docs.typesafe.ai/introduction/quickstart)
- Original jev engineering write-up by @Mr_Buzzoni
- Related community projects: jev-browser-qa, jev-e2e, QA Wolf semantic assertions

## License

MIT
