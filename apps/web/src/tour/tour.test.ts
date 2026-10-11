import { afterEach, expect, test, vi } from 'vitest';

const drive = vi.fn();
let config: {
  steps: { element: string; popover: { title: string; description: string } }[];
  nextBtnText: string;
  prevBtnText: string;
  doneBtnText: string;
  popoverClass: string;
  onDestroyed: () => void;
};
vi.mock('driver.js', () => ({
  driver: (options: typeof config) => {
    config = options;
    return { drive };
  },
}));
vi.mock('driver.js/dist/driver.css', () => ({}));

afterEach(() => vi.clearAllMocks());

test('the tour highlights the main places in Portuguese, then calls back once', async () => {
  const { startTour } = await import('./tour');
  const onDone = vi.fn();
  startTour({ needsFiscalConfig: false, onDone });
  expect(drive).toHaveBeenCalledOnce();
  expect(config.steps.map((s) => s.element)).toEqual([
    '[data-tour="nova-nota"]',
    '[data-tour="notas"]',
    '[data-tour="clientes"]',
    '[data-tour="emitentes"]',
  ]);
  expect(config.steps.map((s) => s.popover.title)).toEqual([
    'Nova nota',
    'Notas e Emitir parecida',
    'Clientes',
    'Emitentes',
  ]);
  expect([config.nextBtnText, config.prevBtnText, config.doneBtnText]).toEqual([
    'Próximo',
    'Voltar',
    'Concluir',
  ]);
  expect(config.popoverClass).toBe('notaflow-tour');
  config.onDestroyed();
  config.onDestroyed();
  expect(onDone).toHaveBeenCalledOnce();
});

test('a skipped fiscal configuration adds a last step about it', async () => {
  const { startTour } = await import('./tour');
  startTour({ needsFiscalConfig: true, onDone: () => {} });
  expect(config.steps.at(-1)?.popover.title).toBe('Configuração fiscal');
  expect(config.steps.at(-1)?.element).toBe('[data-tour="emitentes"]');
});
