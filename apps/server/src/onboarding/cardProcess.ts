import { extractText, getDocumentProxy } from 'unpdf';
import { CardError, parseCardText } from './cardReader';

// A separate process with its own small heap: a hostile PDF can only exhaust this one, which the server kills.
// pdf.js 6 (bundled by unpdf) has no eval path and runs no PDF scripts outside a viewer.
process.once('message', async (message: { pdfBase64: string }) => {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(message.pdfBase64, 'base64')));
    const { text } = await extractText(pdf, { mergePages: true });
    if (text.trim() === '') throw new CardError('card_unreadable');
    process.send?.({ ok: true, card: parseCardText(text) });
  } catch (error) {
    process.send?.({
      ok: false,
      code: error instanceof CardError ? error.code : 'card_unreadable',
    });
  }
});
