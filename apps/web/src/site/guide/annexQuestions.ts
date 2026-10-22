// The Anexo by plain questions: LC 123 names the activities of each Anexo only in words (art. 18 §§5º-B to 5º-M).
export interface AnnexQuestion {
  id: string;
  text: string;
  help: string;
  law: string;
}

export const ANNEX_QUESTIONS: AnnexQuestion[] = [
  {
    id: 'icms_service',
    text: 'É serviço de comunicação ou de transporte intermunicipal ou interestadual de cargas?',
    help: 'Esses serviços pagam o ICMS dentro do Simples, e não o ISS. Esta calculadora não cobre esse caso.',
    law: 'LC 123, art. 18 §5º-E',
  },
  {
    id: 'annex_iv',
    text: 'É obra ou serviço de construção, paisagismo, decoração de interiores, vigilância, limpeza, conservação ou advocacia?',
    help: 'Inclui a construção de imóveis e as obras de engenharia em geral, também por subempreitada. Essas atividades ficam no Anexo IV e pagam a contribuição patronal (CPP) fora do DAS.',
    law: 'LC 123, art. 18 §5º-C',
  },
  {
    id: 'labor',
    text: 'Você cede mão de obra ao cliente?',
    help: 'Ceder mão de obra é colocar pessoas da sua empresa à disposição do cliente, para trabalhar no local dele e sob as ordens dele. Nas atividades do Anexo IV isso não muda o Anexo.',
    law: 'LC 123, art. 18 §5º-C',
  },
  {
    id: 'fator_r_listed',
    text: 'É uma destas atividades: fisioterapia, arquitetura e urbanismo, medicina, enfermagem, odontologia, psicologia, fonoaudiologia, nutrição, administração ou locação de imóveis de terceiros, academia, desenvolvimento ou licença de software, criação de sites, montagem de estandes, laboratório de análises, exames de imagem ou prótese?',
    help: 'Essas atividades ficam no Anexo III quando a folha de salários é de 28% da receita ou mais, e no Anexo V quando é menor. É o Fator R.',
    law: 'LC 123, art. 18 §5º-B XVI, XVIII a XXI, §5º-D e §5º-M',
  },
  {
    id: 'annex_iii_listed',
    text: 'É uma destas atividades: escola ou curso, agência de correios, agência de viagem, autoescola, lotérica, instalação, reparo e manutenção em geral, transporte municipal de passageiros, escritório de contabilidade, produção cinematográfica, artística ou cultural, ou corretagem de seguros?',
    help: 'Essas atividades ficam no Anexo III, sem o Fator R.',
    law: 'LC 123, art. 18 §5º-B',
  },
  {
    id: 'intellectual',
    text: 'É atividade intelectual, técnica, científica, artística ou cultural, como consultoria, engenharia, design, publicidade, auditoria, representação comercial, tradução ou despachante?',
    help: 'Uma atividade intelectual que nenhum outro parágrafo cita vai para o Anexo V, com o Fator R. Ela só vai para o Anexo III se a folha for de 28% da receita ou mais.',
    law: 'LC 123, art. 18 §5º-I, §5º-J e §5º-M',
  },
];

export type AnnexAnswer =
  | { result: 'III' | 'IV' | 'V' | 'fator_r'; law: string }
  | { result: 'out_of_scope'; law: string }
  | { result: 'undecided' };

const lawOf = (id: string) => ANNEX_QUESTIONS.find((question) => question.id === id)?.law ?? '';

// A named activity wins over the intellectual catch-all, which applies only outside Anexos III and IV (§5º-I XII).
export function annexFromAnswers(answers: Record<string, boolean | undefined>): AnnexAnswer {
  if (ANNEX_QUESTIONS.some((question) => answers[question.id] === undefined))
    return { result: 'undecided' };
  const named = (['annex_iv', 'fator_r_listed', 'annex_iii_listed'] as const).filter(
    (id) => answers[id],
  );
  if (answers.icms_service)
    return named.length > 0
      ? { result: 'undecided' }
      : { result: 'out_of_scope', law: lawOf('icms_service') };
  if (answers.labor && !answers.annex_iv) return { result: 'undecided' };
  const [only, ...others] = named;
  if (others.length > 0) return { result: 'undecided' };
  if (only === 'annex_iv') return { result: 'IV', law: lawOf('annex_iv') };
  if (only === 'fator_r_listed') return { result: 'fator_r', law: lawOf('fator_r_listed') };
  if (only === 'annex_iii_listed') return { result: 'III', law: lawOf('annex_iii_listed') };
  if (answers.intellectual) return { result: 'fator_r', law: lawOf('intellectual') };
  return {
    result: 'III',
    law: 'LC 123, Anexo III (serviços não relacionados no art. 18 §5º-C) e art. 18 §5º-I XII',
  };
}
