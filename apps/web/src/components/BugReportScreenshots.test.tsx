// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { installDialogPolyfill } from '../test/dialog';
import { meFor, renderWithMe } from '../test/renderWithMe';
import { stubApi } from '../test/stubApi';
import type * as BugImages from './bugImages';
import { Layout } from './Layout';

// jsdom has no canvas: the resize is its own module, and here it only names the file.
vi.mock('./bugImages', async (original) => {
  const real = await original<typeof BugImages>();
  return {
    ...real,
    prepareBugImage: vi.fn(async (file: File) => {
      if (file.name.startsWith('grande')) throw new real.ImageTooLargeError();
      return { contentType: 'image/webp', data: btoa(file.name), size: 10 };
    }),
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const image = (name: string, type = 'image/png') => new File(['x'], name, { type });

async function open(screenshots: boolean) {
  installDialogPolyfill();
  window.history.replaceState(null, '', '/app/acc/notas');
  const calls = stubApi({
    '/api/public/config': { googleEnabled: false, signupOpen: true, bugScreenshots: screenshots },
    '/api/accounts/acc/bug-reports': { id: 'b1' },
  });
  renderWithMe(
    <Layout title="Notas" accountId="acc">
      x
    </Layout>,
    meFor('user'),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Reportar bug' }));
  await user.type(screen.getByLabelText('Título'), 'Tela branca');
  await user.type(screen.getByLabelText('O que aconteceu?'), 'Abri e ficou branca.');
  return { calls, user };
}

const body = (calls: { url: string; init?: RequestInit }[]) =>
  JSON.parse(String(calls.find((c) => c.url.endsWith('/bug-reports'))?.init?.body)) as Record<
    string,
    unknown
  >;

test('a picked image and a pasted one go in the same JSON request, after a thumbnail', async () => {
  const { calls, user } = await open(true);
  await user.upload(await screen.findByLabelText('Imagens (opcional)'), image('erro.png'));
  expect(await screen.findByAltText('Imagem 1')).toBeTruthy();
  fireEvent.paste(screen.getByLabelText('O que aconteceu?'), {
    clipboardData: { files: [image('colada.png')] },
  });
  expect(await screen.findByAltText('Imagem 2')).toBeTruthy();
  expect(screen.getByText(/As imagens nunca vão para o GitHub/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  await screen.findByText(/Obrigado!/);
  expect(body(calls).images).toEqual([
    { contentType: 'image/webp', data: btoa('erro.png') },
    { contentType: 'image/webp', data: btoa('colada.png') },
  ]);
});

test('a removed image is not sent', async () => {
  const { calls, user } = await open(true);
  const input = await screen.findByLabelText('Imagens (opcional)');
  await user.upload(input, [image('a.png'), image('b.png')]);
  await screen.findByAltText('Imagem 2');
  await user.click(screen.getByRole('button', { name: 'Remover imagem 1' }));
  expect(screen.queryByAltText('Imagem 2')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  await screen.findByText(/Obrigado!/);
  expect(body(calls).images).toEqual([{ contentType: 'image/webp', data: btoa('b.png') }]);
});

test('a fourth image is refused, and the picker turns off at three', async () => {
  const { user } = await open(true);
  const input = await screen.findByLabelText('Imagens (opcional)');
  await user.upload(input, [image('1.png'), image('2.png'), image('3.png'), image('4.png')]);
  await screen.findByAltText('Imagem 3');
  expect(screen.queryByAltText('Imagem 4')).toBeNull();
  expect(screen.getByText('Anexe no máximo 3 imagens.')).toBeTruthy();
  await waitFor(() => expect(input.hasAttribute('disabled')).toBe(true));
});

test('an image still over 1 MB after the resize gets a clear message', async () => {
  const { user } = await open(true);
  await user.upload(await screen.findByLabelText('Imagens (opcional)'), image('grande.png'));
  expect(
    await screen.findByText(
      'A imagem grande.png passa de 1 MB mesmo reduzida. Recorte só a parte que mostra o erro e anexe de novo.',
    ),
  ).toBeTruthy();
  expect(screen.queryByAltText('Imagem 1')).toBeNull();
});

test('a pasted file that is not an image does nothing', async () => {
  const { calls, user } = await open(true);
  await screen.findByLabelText('Imagens (opcional)');
  fireEvent.paste(screen.getByLabelText('O que aconteceu?'), {
    clipboardData: { files: [image('nota.pdf', 'application/pdf')] },
  });
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  await screen.findByText(/Obrigado!/);
  expect(body(calls).images).toBeUndefined();
});

test('with screenshots off the dialog has no picker and ignores a paste', async () => {
  const { calls, user } = await open(false);
  await waitFor(() => expect(calls.some((c) => c.url === '/api/public/config')).toBe(true));
  expect(screen.queryByLabelText('Imagens (opcional)')).toBeNull();
  fireEvent.paste(screen.getByLabelText('O que aconteceu?'), {
    clipboardData: { files: [image('colada.png')] },
  });
  expect(screen.queryByAltText('Imagem 1')).toBeNull();
  expect(screen.queryByText(/As imagens nunca vão para o GitHub/)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  await screen.findByText(/Obrigado!/);
  expect(body(calls).images).toBeUndefined();
});
