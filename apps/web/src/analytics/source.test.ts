// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import {
  campaignOf,
  campaignProperties,
  carryCampaign,
  takeGoogleSignup,
  withCampaign,
} from './source';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

test.each([
  ['?utm_source=instagram&utm_medium=bio&fbclid=x', 'utm_source=instagram&utm_medium=bio'],
  ['?utm_campaign=lancamento&utm_source=whatsapp', 'utm_source=whatsapp&utm_campaign=lancamento'],
  ['?volta=%2Fapp', null],
  ['', null],
])('campaignOf(%s) keeps only the utm_* params', (search, expected) => {
  expect(campaignOf(search)).toBe(expected);
});

test('withCampaign adds the params to a link, keeping its own', () => {
  expect(withCampaign('/cadastro', 'utm_source=instagram')).toBe('/cadastro?utm_source=instagram');
  expect(withCampaign('/entrar?volta=%2Fapp', 'utm_source=instagram')).toBe(
    '/entrar?volta=%2Fapp&utm_source=instagram',
  );
  expect(withCampaign('/cadastro', null)).toBe('/cadastro');
});

test('campaignProperties names the params for the analytics event', () => {
  expect(campaignProperties('utm_source=instagram&utm_medium=bio')).toEqual({
    utm_source: 'instagram',
    utm_medium: 'bio',
  });
  expect(campaignProperties(null)).toEqual({});
});

test('carryCampaign adds the page campaign to the signup and login links only', () => {
  document.body.innerHTML =
    '<a href="/cadastro">a</a><a href="/entrar">b</a><a href="/termos">c</a>';
  carryCampaign(document, '?utm_source=instagram&fbclid=x');
  expect([...document.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
    '/cadastro?utm_source=instagram',
    '/entrar?utm_source=instagram',
    '/termos',
  ]);
});

test('takeGoogleSignup reads the mark Google brings back, and removes it from the address', () => {
  window.history.replaceState(null, '', '/app?cadastro=google&utm_source=instagram');
  expect(takeGoogleSignup()).toEqual({ method: 'google', utm_source: 'instagram' });
  expect(window.location.pathname + window.location.search).toBe('/app');
  expect(takeGoogleSignup()).toBeNull();
});
