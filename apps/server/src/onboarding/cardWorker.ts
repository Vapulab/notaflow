import { parentPort, workerData } from 'node:worker_threads';
import { extractText, getDocumentProxy } from 'unpdf';

// Runs apart from the server: a broken or hostile PDF can only stall this thread, which the caller ends.
// pdf.js 6 (bundled by unpdf) has no eval path and runs no PDF scripts outside a viewer.
const pdf = await getDocumentProxy(new Uint8Array(workerData as Uint8Array));
const { text } = await extractText(pdf, { mergePages: true });
parentPort?.postMessage(text);
