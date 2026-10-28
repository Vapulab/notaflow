export type GuidePage = { path: string; file: string; title: string; description: string };

// Page titles end with " | NotaFlow" in the HTML; `title` is the short name the hub shows.
export const GUIDE_PAGES: GuidePage[] = [
  {
    path: '/guia',
    file: 'guia/index.html',
    title: 'Guia: emita suas notas com segurança',
    description:
      'Um guia simples para quem emite nota fiscal de serviço: escolha o tipo da sua empresa e veja o caminho.',
  },
  {
    path: '/guia/mei',
    file: 'guia/mei.html',
    title: 'MEI',
    description: 'Como o MEI emite nota fiscal de serviço e o que muda para quem usa o NotaFlow.',
  },
  {
    path: '/guia/simples-nacional',
    file: 'guia/simples-nacional.html',
    title: 'Simples Nacional',
    description: 'O caminho de uma empresa do Simples Nacional, da primeira nota à rotina do mês.',
  },
  {
    path: '/guia/primeira-nota',
    file: 'guia/primeira-nota.html',
    title: 'Sua primeira nota no NotaFlow',
    description: 'A primeira nota de serviço no NotaFlow, campo por campo.',
  },
  {
    path: '/guia/rotina-do-mes',
    file: 'guia/rotina-do-mes.html',
    title: 'Rotina do mês no Simples',
    description:
      'O que fazer a cada mês no Simples Nacional: emitir, conferir a receita, declarar e pagar.',
  },
  {
    path: '/guia/lucro-presumido',
    file: 'guia/lucro-presumido.html',
    title: 'Lucro Presumido',
    description: 'Como funciona a emissão de nota fiscal de serviço no Lucro Presumido.',
  },
  {
    path: '/guia/calculadora-simples',
    file: 'guia/calculadora-simples.html',
    title: 'Calculadora do Simples Nacional',
    description: 'Calcule a alíquota e o valor do imposto do Simples Nacional para serviços.',
  },
  {
    path: '/guia/certificado-digital',
    file: 'guia/certificado-digital.html',
    title: 'Certificado digital A1',
    description: 'O que é o certificado digital A1, onde comprar e como usar para emitir notas.',
  },
  {
    path: '/guia/preciso-de-contador',
    file: 'guia/preciso-de-contador.html',
    title: 'Preciso de contador?',
    description: 'Quando dá para cuidar sozinho das notas e quando vale ter um contador.',
  },
  {
    path: '/guia/glossario',
    file: 'guia/glossario.html',
    title: 'Glossário',
    description: 'Os termos de nota fiscal e de imposto explicados em palavras simples.',
  },
  {
    path: '/guia/reforma-tributaria',
    file: 'guia/reforma-tributaria.html',
    title: 'Reforma tributária (IBS e CBS)',
    description: 'O que muda na nota fiscal de serviço com o IBS e a CBS.',
  },
];
