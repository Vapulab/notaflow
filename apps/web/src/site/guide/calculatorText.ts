// The pt-BR texts of the calculator; each fact comes from RFC_ACCOUNTING_GUIDE_SOURCES.md.
import { formatCents } from '../../format';

export const ANNEX_INTRO =
  'O Anexo decide a tabela do imposto, e um Anexo errado é o maior erro do cálculo. Nenhuma lista oficial liga o CNAE a um Anexo: a lei descreve as atividades em palavras. Responda às perguntas ou escolha o Anexo, se já souber. A calculadora cobre só serviços (Anexos III, IV e V): comércio e indústria (Anexos I e II) ficam fora.';
export const ANNEX_SOURCE = 'LC 123/2006, art. 18 §§ 5º-B a 5º-M.';

export const FATOR_R_INTRO =
  'O Fator R é a folha de salários dividida pela receita dos 12 meses, com o mercado interno e a exportação juntos. Com 0,28 (28%) ou mais, a atividade usa o Anexo III; abaixo disso, o Anexo V. O PGDAS-D corta o resultado em duas casas, sem arredondar: 0,2774 vira 0,27. Informe o que a empresa pagou nos mesmos meses da receita do passo 3. Aluguéis e distribuição de lucros não contam. Sem folha, o Fator R é 0,01; com folha e sem receita, é 0,28.';
export const FATOR_R_SOURCE =
  'LC 123/2006, art. 18 §5º-J, §5º-K, §5º-M e §§ 24 a 26; Res. CGSN 140/2018, art. 26; manual do PGDAS-D, item 8.2.1.';
export const PAYROLL_HELP = {
  salaries:
    'O que a empresa pagou a pessoas físicas pelo trabalho, informado no eSocial ou na GFIP. O 13º salário conta no mês em que a contribuição dele é recolhida.',
  proLabore: 'As retiradas de pró-labore dos sócios.',
  fgts: 'O FGTS efetivamente recolhido.',
  cpp: 'A contribuição previdenciária patronal efetivamente recolhida.',
  other:
    'Outras remunerações a pessoas físicas pelo trabalho, informadas no eSocial ou na GFIP. Não inclua aluguéis nem lucros distribuídos.',
} as const;

export const RBT12_INTRO =
  'A faixa do imposto vem da receita bruta dos 12 meses antes do mês do cálculo, sem contar o próprio mês (RBT12). A exportação tem a sua própria conta. Uma empresa com menos de 13 meses usa a regra proporcional: no primeiro mês, a receita do mês × 12; nos 11 meses seguintes, a média dos meses anteriores × 12. Um mês sem receita entra na média. Uma receita de 12 meses igual a zero conta como R$ 1,00.';
export const START_HINT = 'Deixe em branco se a empresa tem 13 meses de atividade ou mais.';
export const FIRST_MONTH =
  'Primeiro mês de atividade: a receita dos 12 meses é a receita deste mês × 12.';
export const YEAR_HINT =
  'O sublimite de R$ 3,6 milhões do ISS vale para a receita do ano, e não para a dos 12 meses.';
export const BAND6_INTRO =
  'A receita dos 12 meses passa de R$ 3,6 milhões: é a faixa 6. Onde fica o ISS depende da receita do ano. Responda como na configuração fiscal do NotaFlow.';
export const RBT12_SOURCE =
  'LC 123/2006, art. 18 §1º e §2º, art. 13-A e art. 20; Res. CGSN 140/2018, arts. 21 a 24; manual do PGDAS-D, item 8.3.';

export const MONTH_INTRO =
  'Separe a receita do mês como no PGDAS-D. Na receita com ISS retido, sai do DAS só a parte do ISS; as partes federais ficam. Na exportação, saem as partes de ISS, PIS e Cofins; IRPJ, CSLL e CPP ficam.';
export const RETAINED_OPTIONS: [string, string][] = [
  ['rule', 'Pela regra: a faixa do mês anterior ao serviço'],
  ['first_month', 'O serviço foi no primeiro mês de atividade: 2%'],
  ['not_on_invoice', 'A nota não mostrou a alíquota: 5%'],
];
export const RETAINED_HINT =
  'O cliente retém o ISS pela faixa do mês anterior ao serviço, com a receita dos 12 meses antes desse mês. A calculadora considera que o serviço foi no mês do cálculo.';
export const EXPORT_HINT =
  'Serviço para cliente no exterior, com pagamento que entra no país como divisa.';
export const MONTH_SOURCE =
  'LC 123/2006, art. 18 §4º-A e §14; Res. CGSN 140/2018, art. 25 §3º, §4º e §9º, e art. 27.';

export const ACTIVITIES_INTRO =
  'Cada atividade usa o seu próprio Anexo e a mesma receita dos 12 meses, como na segregação do PGDAS-D. A atividade dos passos 1 e 4 é a primeira; adicione as outras aqui.';
export const ACTIVITIES_SOURCE = 'Res. CGSN 140/2018, art. 22 §1º e art. 25 §1º.';

export const BAD_MONEY = 'Valor inválido. Use o formato 1.234,56.';
export const UNDECIDED_SHORT = 'Ainda não dá para saber o Anexo: responda a todas as perguntas.';
export const UNDECIDED =
  'Suas respostas não decidem o Anexo, e a calculadora não adivinha. Responda a todas as perguntas, ou leve a dúvida ao seu contador.';
export const OUT_OF_SCOPE =
  'Comunicação e transporte intermunicipal ou interestadual de cargas pagam o ICMS dentro do Simples (LC 123, art. 18 §5º-E). A calculadora não cobre esses serviços.';
export const EXIT =
  'Acima de R$ 4,8 milhões, a empresa sai do Simples Nacional (LC 123, art. 3º II e §9º). A calculadora não calcula esse caso: fale com seu contador.';
export const OVER_SUBLIMIT =
  'A receita deste ano passou mais de 20% do sublimite de R$ 3,6 milhões. O ISS sai do DAS já no mês seguinte ao excesso, e as duas partes da receita seguem regras diferentes (LC 123, art. 20 §1º e §1º-A; Res. CGSN 140, art. 24). A calculadora não calcula esse caso: confirme com seu contador.';
export const FIXED_ISS = [
  'O ISS em valor fixo vale para o escritório de contabilidade (LC 123, art. 18 §22-A) e para a microempresa com receita de até R$ 360 mil no ano anterior, quando o município permite (art. 18 §18). As outras sociedades de profissionais não pagam ISS fixo no Simples (Res. CGSN 140, art. 25 §12).',
  'A calculadora não calcula esse caso: confirme com seu contador.',
];
export const WARNINGS = {
  band6:
    'A receita dos 12 meses está na faixa 6, acima do sublimite de R$ 3,6 milhões. Onde fica o ISS depende da receita do ano (LC 123, art. 13-A e art. 20; Res. CGSN 140, art. 21 III b e art. 24). Confirme com seu contador.',
  iss_cap:
    'Na faixa 5, a parte do ISS passou de 5% e ficou em 5%. A diferença foi para os tributos federais da mesma faixa (LC 123, art. 18 §1º-B I). Confirme com seu contador.',
} as const;
export const COMPARE_NEUTRAL =
  'A diferença pode ter um motivo, como uma atividade em outro Anexo. Leve este cálculo ao seu contador.';
export const TABLES_DATE =
  'Tabelas da LC 123/2006, conferidas em 21 de outubro de 2026. A partir de 1º de janeiro de 2027, a Res. CGSN 190/2026 muda as tabelas para a CBS e o IBS.';

export function windowText(
  window: { rbt12Cents: number; rule: 'full' | 'first_month' | 'proportional'; months: string[] },
  label: string,
  showMonth: (month: string) => string,
): string {
  const value = formatCents(window.rbt12Cents);
  const first = window.months[0] ?? '';
  const last = window.months[window.months.length - 1] ?? '';
  if (window.rule === 'first_month')
    return `${label}: ${value}, a receita do primeiro mês × 12 (Res. CGSN 140, art. 22 §2º).`;
  if (window.rule === 'proportional')
    return `${label}: ${value}, a média de ${window.months.length} meses (${showMonth(first)} a ${showMonth(last)}) × 12, porque a empresa tem menos de 13 meses (Res. CGSN 140, art. 22 §3º).`;
  return `${label}: ${value}, a soma de ${showMonth(first)} a ${showMonth(last)} (Res. CGSN 140, art. 22 §1º).`;
}
