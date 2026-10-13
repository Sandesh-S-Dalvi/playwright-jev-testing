import { test, expect, request } from '@playwright/test';
import { analyzeFailure, formatAnalysis } from '../src/jev/index.js';

/**
 * Petstore API tests with Jev failure intelligence.
 * Base: https://petstore3.swagger.io/api/v3
 *
 * On failure the afterEach calls Jev to classify flake vs genuine
 * and recommend retry / update-test / file-ticket.
 */

const BASE = 'https://petstore3.swagger.io/api/v3';

test.describe('Petstore API + Jev failure analysis', () => {
  let failureContext: {
    title: string;
    error?: string;
    status?: number;
    body?: string;
    url?: string;
    method?: string;
  } | null = null;

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== 'failed' && testInfo.status !== 'timedOut') return;
    if (!failureContext) return;

    try {
      const analysis = await analyzeFailure({
        testTitle: failureContext.title,
        errorMessage: failureContext.error || testInfo.error?.message || 'unknown',
        stack: testInfo.error?.stack,
        statusCode: failureContext.status,
        responseBody: failureContext.body,
        requestUrl: failureContext.url,
        requestMethod: failureContext.method,
        retryCount: testInfo.retry,
        durationMs: testInfo.duration,
      });

      const report = formatAnalysis(analysis);
      console.log(report);
      await testInfo.attach('jev-failure-analysis', {
        body: report,
        contentType: 'text/plain',
      });
    } catch (err) {
      console.warn('Jev analysis failed:', err);
    } finally {
      failureContext = null;
    }
  });

  test('GET /pet/findByStatus returns available pets', async () => {
    const api = await request.newContext();
    const response = await api.get(`${BASE}/pet/findByStatus`, {
      params: { status: 'available' },
    });

    failureContext = {
      title: 'GET /pet/findByStatus returns available pets',
      status: response.status(),
      body: await response.text(),
      url: response.url(),
      method: 'GET',
    };

    expect(response.ok()).toBeTruthy();
    const pets = await response.json();
    expect(Array.isArray(pets)).toBeTruthy();
    expect(pets.length).toBeGreaterThan(0);
    expect(pets[0]).toHaveProperty('id');
    expect(pets[0]).toHaveProperty('name');
  });

  test('GET /pet/{id} for a known pet (or 404 is acceptable)', async () => {
    const api = await request.newContext();
    // Petstore often has pet id 1; if missing the assertion will fail and Jev will analyze
    const response = await api.get(`${BASE}/pet/1`);

    failureContext = {
      title: 'GET /pet/{id} for a known pet',
      status: response.status(),
      body: await response.text(),
      url: response.url(),
      method: 'GET',
    };

    // Intentional soft expectation: either 200 with a pet or 404
    // Change to expect(response.status()).toBe(200) to force a failure path for demo
    if (response.status() === 200) {
      const pet = await response.json();
      expect(pet).toHaveProperty('id');
      expect(pet).toHaveProperty('name');
    } else {
      expect(response.status()).toBe(404);
    }
  });

  test('POST /pet creates a pet (may fail if schema drifts — Jev will classify)', async () => {
    const api = await request.newContext();
    const newPet = {
      id: Date.now() % 1_000_000,
      name: `jev-test-${Date.now()}`,
      photoUrls: ['https://example.com/pet.jpg'],
      status: 'available',
    };

    const response = await api.post(`${BASE}/pet`, {
      data: newPet,
      headers: { 'Content-Type': 'application/json' },
    });

    failureContext = {
      title: 'POST /pet creates a pet',
      status: response.status(),
      body: await response.text(),
      url: response.url(),
      method: 'POST',
    };

    // Accept 200 or 201; anything else fails and triggers analysis
    expect([200, 201]).toContain(response.status());
    if (response.ok()) {
      const created = await response.json();
      expect(created.name).toBe(newPet.name);
    }
  });
});
