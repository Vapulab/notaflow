// A DANFSe link token is a bearer secret: no log line or error event may keep it.
const LINK_TOKEN = /\/n\/[A-Za-z0-9_-]+/g;

export function redactLinkToken(text: string): string {
  return text.replace(LINK_TOKEN, '/n/:token');
}
