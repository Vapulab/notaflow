import { type DriveStep, driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const STEPS: DriveStep[] = [
  {
    element: '[data-tour="nova-nota"]',
    popover: {
      title: 'Nova nota',
      description: 'Emita uma nota para um cliente, no modo simples ou completo.',
    },
  },
  {
    element: '[data-tour="notas"]',
    popover: {
      title: 'Notas e Emitir parecida',
      description:
        'Todas as notas da empresa, também as emitidas fora do NotaFlow. Em cada uma, "Emitir parecida" copia a nota para emitir outra.',
    },
  },
  {
    element: '[data-tour="clientes"]',
    popover: { title: 'Clientes', description: 'Os tomadores das notas e os dados de cada um.' },
  },
  {
    element: '[data-tour="emitentes"]',
    popover: {
      title: 'Emitentes',
      description:
        'O certificado digital, a sincronização com o sistema nacional, e outras empresas.',
    },
  },
];

const FISCAL_STEP: DriveStep = {
  element: '[data-tour="emitentes"]',
  popover: {
    title: 'Configuração fiscal',
    description:
      'Antes da primeira nota nova, informe o anexo, a faixa e o ISS do Simples na página do emitente.',
  },
};

// The first-visit tour of the dashboard; onDone runs once, whether the user finishes or closes it.
export function startTour(options: { needsFiscalConfig: boolean; onDone: () => void }): void {
  let done = false;
  driver({
    steps: options.needsFiscalConfig ? [...STEPS, FISCAL_STEP] : STEPS,
    showProgress: true,
    progressText: '{{current}} de {{total}}',
    nextBtnText: 'Próximo',
    prevBtnText: 'Voltar',
    doneBtnText: 'Concluir',
    popoverClass: 'notaflow-tour',
    onDestroyed: () => {
      if (done) return;
      done = true;
      options.onDone();
    },
  }).drive();
}
