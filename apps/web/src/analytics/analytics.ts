import type { PostHog, PostHogConfig } from 'posthog-js';
import { redactLinkToken } from '../observability/linkToken';

export interface AnalyticsConfig {
  token: string;
  host: string;
}

// The privacy promise of /privacidade, in code: no cookies, no e-mail, and recordings without any text.
export const POSTHOG_OPTIONS: Partial<PostHogConfig> = {
  persistence: 'memory',
  autocapture: false,
  disable_session_recording: false,
  // The console can hold API error details; recordings never carry it.
  enable_recording_console_log: false,
  // The screens show customers' names, documents, and amounts: a recording keeps the layout, never the text.
  session_recording: {
    maskAllInputs: true,
    maskTextSelector: '*',
    recordCrossOriginIframes: false,
  },
  disable_surveys: true,
  mask_all_text: true,
  mask_all_element_attributes: true,
  person_profiles: 'identified_only',
  capture_pageview: 'history_change',
  capture_pageleave: false,
};

let client: PostHog | null = null;
// Calls made before PostHog loads, replayed in order once it does; dropped when it never will.
let waiting: ((posthog: PostHog) => void)[] | null = [];

const URL_PROPERTIES = [
  '$current_url',
  '$pathname',
  '$referrer',
  '$initial_referrer',
  '$initial_current_url',
  '$session_entry_url',
];

// Defence in depth for every page: no event carries a link token in a URL property.
export function redactEventUrls<T extends { properties?: Record<string, unknown> } | null>(
  event: T,
): T {
  if (!event?.properties) return event;
  const properties = { ...event.properties };
  for (const key of URL_PROPERTIES) {
    const value = properties[key];
    if (typeof value === 'string') properties[key] = redactLinkToken(value);
  }
  return { ...event, properties };
}

// The link page's URL is the secret: it gets no pageview and no recording, only its own event.
export function optionsFor(pathname: string): Partial<PostHogConfig> {
  const base = { ...POSTHOG_OPTIONS, before_send: redactEventUrls };
  return pathname.startsWith('/n/')
    ? { ...base, capture_pageview: false, disable_session_recording: true }
    : base;
}

// Loaded on demand, so the app does not wait for it and runs the same without it.
export async function startAnalytics(config: AnalyticsConfig | null): Promise<void> {
  if (client) return;
  if (!config) {
    waiting = null;
    return;
  }
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(config.token, {
      ...optionsFor(globalThis.location?.pathname ?? ''),
      api_host: config.host,
    });
    client = posthog;
    for (const call of waiting ?? []) call(posthog);
  } catch {
    // A blocked or failed analytics script never breaks the app.
  }
  waiting = null;
}

function withClient(call: (posthog: PostHog) => void): void {
  if (client) call(client);
  else waiting?.push(call);
}

// The internal id only, set as the id: identify() would merge a new anonymous id on every page load.
export function identifyUser(userId: string): void {
  withClient((posthog) => {
    if (posthog.get_distinct_id() === userId) return;
    posthog.reset({ bootstrap: { distinctID: userId, isIdentifiedID: true } });
  });
}

export function track(event: AnalyticsEvent, properties?: Record<string, string | boolean>): void {
  withClient((posthog) => posthog.capture(event, properties));
}

export function resetAnalytics(): void {
  client?.reset();
}

export type AnalyticsEvent =
  | 'signup_completed'
  | 'onboarding_step'
  | 'invoice_issued'
  // The public guide; its events never carry amounts.
  | 'guide_path'
  | 'guide_cnpj_regime'
  | 'guide_calculator'
  | 'waitlist_signup'
  // The public DANFSe link page; the event has no properties, so no token.
  | 'danfse_link_viewed';

// For tests: forget the client between them.
export function stopAnalytics(): void {
  client = null;
  waiting = [];
}
