import type { PostHog, PostHogConfig } from 'posthog-js';

export interface AnalyticsConfig {
  token: string;
  host: string;
}

// The privacy promise of /privacidade, in code: no cookies, no screen recording, no page text, no e-mail.
export const POSTHOG_OPTIONS: Partial<PostHogConfig> = {
  persistence: 'memory',
  autocapture: false,
  disable_session_recording: true,
  disable_surveys: true,
  mask_all_text: true,
  mask_all_element_attributes: true,
  person_profiles: 'identified_only',
  capture_pageview: 'history_change',
  capture_pageleave: false,
};

let client: PostHog | null = null;

// Loaded on demand, so the app does not wait for it and runs the same without it.
export async function startAnalytics(config: AnalyticsConfig | null): Promise<void> {
  if (!config || client) return;
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(config.token, { ...POSTHOG_OPTIONS, api_host: config.host });
    client = posthog;
  } catch {
    // A blocked or failed analytics script never breaks the app.
  }
}

// The internal id only, set as the id: identify() would merge a new anonymous id on every page load.
export function identifyUser(userId: string): void {
  if (!client || client.get_distinct_id() === userId) return;
  client.reset({ bootstrap: { distinctID: userId, isIdentifiedID: true } });
}

export function track(event: AnalyticsEvent, properties?: Record<string, string | boolean>): void {
  client?.capture(event, properties);
}

export function resetAnalytics(): void {
  client?.reset();
}

export type AnalyticsEvent = 'signup_completed' | 'onboarding_step' | 'invoice_issued';

// For tests: forget the client between them.
export function stopAnalytics(): void {
  client = null;
}
