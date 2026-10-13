// The web app sends the landing page's utm_* in this header; Google brings them back in the OAuth state.
export const SIGNUP_SOURCE_HEADER = 'x-notaflow-source';
// The key of the OAuth state's additionalData (client input, like the header).
export const SIGNUP_SOURCE_STATE_KEY = 'signupSource';

export interface SignupSource {
  source: string;
  medium: string | null;
  campaign: string | null;
}

// The value comes from the browser and shows in the admin panel: anything else than a short slug is dropped.
const SLUG = /^[a-z0-9_-]{1,100}$/;

function slug(value: string | null): string | null {
  const lower = value?.toLowerCase() ?? null;
  return lower !== null && SLUG.test(lower) ? lower : null;
}

// "utm_source=x&utm_medium=y&utm_campaign=z"; null without a valid utm_source.
export function parseSignupSource(raw: unknown): SignupSource | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  const params = new URLSearchParams(raw);
  const source = slug(params.get('utm_source'));
  if (!source) return null;
  return {
    source,
    medium: slug(params.get('utm_medium')),
    campaign: slug(params.get('utm_campaign')),
  };
}
