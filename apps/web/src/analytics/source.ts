const CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
// newUserCallbackURL carries it, so the app knows that a Google login created the user.
const GOOGLE_SIGNUP_MARK = 'cadastro';

// The utm_* of an address, in a fixed order; null when there is none.
export function campaignOf(search: string): string | null {
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of CAMPAIGN_KEYS) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  return kept.size > 0 ? kept.toString() : null;
}

export function withCampaign(href: string, campaign: string | null): string {
  if (!campaign) return href;
  return `${href}${href.includes('?') ? '&' : '?'}${campaign}`;
}

// The landing page is its own document: without this, the campaign stops at the first click.
export function carryCampaign(root: ParentNode, search: string): void {
  const campaign = campaignOf(search);
  if (!campaign) return;
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href="/cadastro"], a[href="/entrar"]')) {
    link.setAttribute('href', withCampaign(link.getAttribute('href') ?? '', campaign));
  }
}

export function campaignProperties(campaign: string | null): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(campaign ?? ''));
}

export function googleSignupReturn(campaign: string | null): string {
  return withCampaign(`/app?${GOOGLE_SIGNUP_MARK}=google`, campaign);
}

// Read once at startup; the address loses the mark, so a reload does not count the signup again.
export function takeGoogleSignup(): Record<string, string> | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get(GOOGLE_SIGNUP_MARK) !== 'google') return null;
  const campaign = campaignOf(window.location.search);
  window.history.replaceState(window.history.state, '', window.location.pathname);
  return { method: 'google', ...campaignProperties(campaign) };
}
