// A DANFSe link token is a bearer secret: it may only travel to our own API, never to a tracker.
const LINK_TOKEN = /\/n\/[A-Za-z0-9_-]{43}/g;

export function redactLinkToken(text: string): string {
  return text.replace(LINK_TOKEN, '/n/:token');
}
