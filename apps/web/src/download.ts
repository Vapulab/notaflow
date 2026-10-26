import { ApiError } from './api';

// Fetches a file from the API and hands it to the browser, so an API error reaches the page.
export async function downloadFile(url: string): Promise<void> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const code =
      typeof data === 'object' && data !== null && 'error' in data
        ? String(data.error)
        : `http_${response.status}`;
    throw new ApiError(response.status, code);
  }
  const name =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'arquivo';
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
  URL.revokeObjectURL(href);
}
