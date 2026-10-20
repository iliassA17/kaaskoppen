const { test, expect } = require('@playwright/test');
const { accessState, TRIAL_MS, planOptions } = require('../subscription-access.js');

test('proefgebruik stopt precies zeven dagen na de vastgelegde start', () => {
  const started = Date.UTC(2026, 9, 20, 12);
  const access = {status: 'trial', trialStartedAt: new Date(started)};
  expect(accessState({enabled: true}, access, started + TRIAL_MS - 1).allowed).toBe(true);
  expect(accessState({enabled: true}, access, started + TRIAL_MS).allowed).toBe(false);
  expect(accessState({enabled: true}, access, started + TRIAL_MS + 1).kind).toBe('expired');
});

test('abonnementen en eenmalige toegang krijgen alleen hun vastgelegde looptijd', () => {
  const now = Date.now();
  expect(accessState({enabled: true}, {status: 'active', validUntil: new Date(now + 1000)}, now).allowed).toBe(true);
  expect(accessState({enabled: true}, {status: 'active', validUntil: new Date(now)}, now).allowed).toBe(false);
  for (const status of ['lifetime', 'free']) expect(accessState({enabled: true}, {status}, now).allowed).toBe(true);
  for (const status of ['pending', 'cancelled', 'blocked']) expect(accessState({enabled: true}, {status}, now).allowed).toBe(false);
  expect(accessState({enabled: true}, null, now).allowed).toBe(false);
  expect(accessState({enabled: false}, null, now).allowed).toBe(true);
});

test('alle vier opties tonen alleen werkelijk ingestelde prijzen', () => {
  const options = planOptions({plans: {maand: {amountCents: 1599}, jaar: {amountCents: 0}}});
  expect(options.map(plan => plan.id)).toEqual(['maand', 'halfjaar', 'jaar', 'levenslang']);
  expect(options.map(plan => plan.amountCents)).toEqual([1599, null, null, null]);
});
