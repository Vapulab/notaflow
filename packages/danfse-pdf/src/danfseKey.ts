import type { DanfseMark } from './renderDanfse';

// One object per mark, so a late job of an old mark cannot overwrite the watermarked PDF.
export function danfseKey(accessKey: string, mark: DanfseMark): string {
  return `danfse/${accessKey}-${mark}.pdf`;
}
