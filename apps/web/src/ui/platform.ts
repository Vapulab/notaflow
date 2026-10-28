const APPLE = /iPhone|iPad|Macintosh|MacIntel/;

// iPadOS 13+ reports "MacIntel"/"Macintosh", so it falls in the Apple group too.
export function isApplePlatform(
  nav: { platform?: string; userAgent?: string } | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
): boolean {
  return APPLE.test(`${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`);
}
