import type { PostHog, PostHogConfig } from 'posthog-js';

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

// Loaded on demand, so the app does not wait for it and runs the same without it.
export async function startAnalytics(config: AnalyticsConfig | null): Promise<void> {
  if (client) return;
  if (!config) {
    waiting = null;
    return;
  }
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(config.token, { ...POSTHOG_OPTIONS, api_host: config.host });
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

export type AnalyticsEvent = 'signup_completed' | 'onboarding_step' | 'invoice_issued';

// For tests: forget the client between them.
export function stopAnalytics(): void {
  client = null;
  waiting = [];
}
