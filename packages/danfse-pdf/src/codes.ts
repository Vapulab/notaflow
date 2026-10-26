// Descriptions come from the xs:documentation of the enumerations in provider-nacional/schemas/nt009.

export const ISSUER_TYPE: Record<string, string> = { '1': 'Prestador', '2': 'Tomador', '3': 'Intermediário' };

export const NFSE_STATUS: Record<string, string> = {
  '100': 'NFS-e Gerada',
  '102': 'NFS-e de Decisão Judicial',
  '103': 'NFS-e Avulsa',
  '107': 'NFS-e MEI',
};

export const PURPOSE: Record<string, string> = { '0': 'NFS-e regular' };

export const ENVIRONMENT_TYPE: Record<string, string> = { '1': 'Produção', '2': 'Homologação' };

export const GENERATOR_ENVIRONMENT: Record<string, string> = { '1': 'Prefeitura', '2': 'Sistema Nacional da NFS-e' };

export const SIMPLES_NATIONAL: Record<string, string> = {
  '1': 'Não Optante',
  '2': 'Optante - Microempreendedor Individual (MEI)',
  '3': 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)',
};

export const SIMPLES_REGIME: Record<string, string> = {
  '1': 'Regime de apuração dos tributos federais e municipal pelo SN',
  '2': 'Regime de apuração dos tributos federais pelo SN e ISSQN por fora do SN conforme respectiva legislação municipal do tributo',
  '3': 'Regime de apuração dos tributos federais e municipal por fora do SN conforme respectivas legislações federal e municipal de cada tributo',
};

export const SPECIAL_REGIME: Record<string, string> = {
  '0': 'Nenhum',
  '1': 'Ato Cooperado (Cooperativa)',
  '2': 'Estimativa',
  '3': 'Microempresa Municipal',
  '4': 'Notário ou Registrador',
  '5': 'Profissional Autônomo',
  '6': 'Sociedade de Profissionais',
  '9': 'Outros',
};

export const ISSQN_TAXATION: Record<string, string> = {
  '1': 'Operação tributável',
  '2': 'Imunidade',
  '3': 'Exportação de serviço',
  '4': 'Não Incidência',
};

export const ISSQN_IMMUNITY: Record<string, string> = {
  '0': 'Imunidade (tipo não informado na nota de origem)',
  '1': 'Patrimônio, renda ou serviços, uns dos outros (CF88, Art 150, VI, a)',
  '2': 'Templos de qualquer culto (CF88, Art 150, VI, b)',
  '3': 'Patrimônio, renda ou serviços dos partidos políticos, inclusive suas fundações, das entidades sindicais dos trabalhadores, das instituições de educação e de assistência social, sem fins lucrativos, atendidos os requisitos da lei (CF88, Art 150, VI, c)',
  '4': 'Livros, jornais, periódicos e o papel destinado a sua impressão (CF88, Art 150, VI, d)',
  '5': 'Fonogramas e videofonogramas musicais produzidos no Brasil contendo obras musicais ou literomusicais de autores brasileiros e/ou obras em geral interpretadas por artistas brasileiros bem como os suportes materiais ou arquivos digitais que os contenham, salvo na etapa de replicação industrial de mídias ópticas de leitura a laser. (CF88, Art 150, VI, e)',
};

export const ISSQN_SUSPENSION: Record<string, string> = {
  '1': 'Exigibilidade Suspensa por Decisão Judicial',
  '2': 'Exigibilidade Suspensa por Processo Administrativo',
};

export const MUNICIPAL_BENEFIT: Record<string, string> = {
  '1': 'Isenção',
  '2': 'Redução da BC em',
  '3': 'Redução da BC em',
  '4': 'Alíquota Diferenciada de',
};

export const ISSQN_WITHHOLDING: Record<string, string> = {
  '1': 'Não Retido',
  '2': 'Retido pelo Tomador',
  '3': 'Retido pelo Intermediario',
};

export const PIS_COFINS_WITHHOLDING: Record<string, string> = {
  '0': 'PIS/COFINS/CSLL Não Retidos',
  '1': 'PIS/COFINS Retidos',
  '2': 'PIS/COFINS Não Retidos',
  '3': 'PIS/COFINS/CSLL Retidos',
  '4': 'PIS/COFINS Retidos, CSLL Não Retido',
  '5': 'PIS Retido, COFINS/CSLL Não Retido',
  '6': 'COFINS Retido, PIS/CSLL Não Retido',
  '7': 'PIS Não Retido, COFINS/CSLL Retidos',
  '8': 'PIS/COFINS Não Retidos, CSLL Retido',
  '9': 'COFINS Não Retido, PIS/CSLL Retidos',
};

// IBGE state codes (the first two digits of a municipality code).
export const UF_BY_IBGE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};
