// NT 008 v1.02 item 2.4.5, without the "Canhoto" rows. Units are cm from the top-left of the A4 page.

export type BlockKey =
  | 'header' | 'identification' | 'provider' | 'customer' | 'recipient' | 'intermediary'
  | 'service' | 'issqn' | 'federal' | 'ibsCbs' | 'total' | 'complementary';

export interface LayoutBlock { key: BlockKey; title: string; x: number; y: number; width: number; height: number }

export const BLOCKS: readonly LayoutBlock[] = [
  { key: 'header', title: 'Cabeçalho', x: 0.3, y: 0.3, width: 20.4, height: 1.16 },
  { key: 'identification', title: 'Dados da NFS-e', x: 0.3, y: 1.48, width: 20.4, height: 2.84 },
  { key: 'provider', title: 'Prestador / Fornecedor', x: 0.3, y: 4.34, width: 20.4, height: 2.57 },
  { key: 'customer', title: 'Tomador / Adquirente', x: 0.3, y: 6.92, width: 20.4, height: 1.93 },
  { key: 'recipient', title: 'Destinatário da Operação', x: 0.3, y: 8.86, width: 20.4, height: 1.93 },
  { key: 'intermediary', title: 'Intermediário da Operação', x: 0.3, y: 10.8, width: 20.4, height: 1.92 },
  { key: 'service', title: 'Serviço Prestado', x: 0.3, y: 12.74, width: 20.4, height: 1.68 },
  { key: 'issqn', title: 'Tributação Municipal (ISSQN)', x: 0.3, y: 14.43, width: 20.4, height: 2.57 },
  { key: 'federal', title: 'Tributação Federal (Exceto CBS)', x: 0.3, y: 17.02, width: 20.4, height: 1.28 },
  { key: 'ibsCbs', title: 'Tributação IBS / CBS', x: 0.3, y: 18.32, width: 20.4, height: 2.57 },
  { key: 'total', title: 'Valor Total da NFS-e', x: 0.3, y: 20.9, width: 20.4, height: 1.36 },
  { key: 'complementary', title: 'Informações Complementares', x: 0.3, y: 22.27, width: 20.4, height: 0.8 },
];

// [key, block, label, xmlPath, x, y, width, height, maxChars?]
const ROWS = [
  // Header: the municipality text is "Município: name / UF" and is hidden when cTribNac is 99
  ['logo', 'header', 'Logomarca da NFSe', '', 0.49, 0.44, 4.0, 0.85],
  ['documentTitle', 'header', 'Documento Auxiliar da NFS-e', '', 5.41, 0.3, 10.19, 1.16],
  ['municipality', 'header', 'Município', 'NFSe/infNFSe/ + NFSe/infNFSe/emit/enderNac/ xLocEmi + UF', 15.62, 0.3, 5.09, 0.64],
  ['generatorEnvironment', 'header', 'Ambiente Gerador', 'NFSe/infNFSe/ ambGer', 15.62, 0.97, 5.09, 0.24, 1],
  ['environmentType', 'header', 'Tipo de Ambiente', 'NFSe/infNFSe/DPS/infDPS/ tpAmb', 15.62, 1.22, 5.09, 0.24, 1],

  // Identification
  ['accessKey', 'identification', 'Chave de Acesso da NFS-e', 'NFSe/infNFSe/ id', 0.3, 1.48, 15.3, 0.77, 50],
  ['qrCode', 'identification', 'QR Code', '', 17.48, 1.67, 1.52, 1.52],
  ['nfseNumber', 'identification', 'Número da NFS-e', 'NFSe/infNFSe/ nNFSe', 0.3, 2.27, 5.09, 0.67, 13],
  ['competence', 'identification', 'Competência da NFS-e', 'NFSe/infNFSe/DPS/infDPS/ dCompet', 5.41, 2.27, 5.09, 0.67, 10],
  ['nfseIssuedAt', 'identification', 'Data e Hora da Emissão da NFS-e', 'NFSe/infNFSe/ dhProc', 10.51, 2.27, 5.09, 0.67, 19],
  ['dpsNumber', 'identification', 'Número da DPS', 'NFSe/infNFSe/DPS/infDPS/ nDPS', 0.3, 2.96, 5.09, 0.67, 15],
  ['dpsSeries', 'identification', 'Série da DPS', 'NFSe/infNFSe/DPS/infDPS/ serie', 5.41, 2.96, 5.09, 0.67, 5],
  ['dpsIssuedAt', 'identification', 'Data e Hora da Emissão da DPS', 'NFSe/infNFSe/DPS/infDPS/ dhEmi', 10.51, 2.96, 5.09, 0.67, 19],
  ['issuerType', 'identification', 'Emitente da NFS-e', 'NFSe/infNFSe/DPS/infDPS/ tpEmit', 0.3, 3.65, 5.09, 0.67, 13],
  ['nfseStatus', 'identification', 'Situação da NFS-e', 'NFSe/infNFSe/ cStat', 5.41, 3.65, 5.09, 0.67, 40],
  ['purpose', 'identification', 'Finalidade', 'NFSe/infNFSe/DPS/infDPS/IBSCBS/ finNFSe', 10.51, 3.65, 5.09, 0.67, 40],
  ['qrCaption', 'identification', 'Complemento do QR Code', '', 15.8, 3.36, 4.72, 0.68],

  // Provider
  ['providerDocument', 'provider', 'CNPJ / CPF / NIF', 'NFSe/infNFSe/DPS/infDPS/prest/ CNPJ / CPF / NIF', 5.41, 4.34, 5.09, 0.63, 40],
  ['providerMunicipalRegistration', 'provider', 'Indicador Municipal (Inscrição)', 'NFSe/infNFSe/DPS/infDPS/prest/ IM', 10.51, 4.34, 5.09, 0.63, 15],
  ['providerPhone', 'provider', 'Telefone', 'NFSe/infNFSe/DPS/infDPS/prest/ fone', 15.62, 4.34, 5.09, 0.63, 20],
  ['providerName', 'provider', 'Nome / Nome Empresarial', 'NFSe/infNFSe/DPS/infDPS/prest/ xNome', 0.3, 4.98, 10.19, 0.63, 80],
  ['providerCity', 'provider', 'Município / Sigla UF', 'NFSe/infNFSe/DPS/infDPS/prest/end/endNac/ ou NFSe/infNFSe/DPS/infDPS/prest/end/endExt/ cMun ou xCidade', 10.51, 4.98, 5.09, 0.63, 37],
  ['providerPostalCode', 'provider', 'Código IBGE / CEP', 'NFSe/infNFSe/DPS/infDPS/prest/end/endNac/ ou NFSe/infNFSe/DPS/infDPS/prest/end/endExt/ cMun + CEP ou cEndPost', 15.62, 4.98, 5.09, 0.63, 21],
  ['providerAddress', 'provider', 'Endereço', 'NFSe/infNFSe/DPS/infDPS/prest/end/ xLgr, nro, xCpl, xBairro', 0.3, 5.62, 10.19, 0.63, 80],
  ['providerEmail', 'provider', 'Email', 'NFSe/infNFSe/DPS/infDPS/prest/ email', 10.51, 5.62, 10.19, 0.63, 80],
  ['providerSimplesNacional', 'provider', 'Simples Nacional na Data de Competência', 'NFSe/infNFSe/DPS/infDPS/prest/regTrib/ opSimpNac', 0.3, 6.28, 5.09, 0.63, 40],
  ['providerSimplesRegime', 'provider', 'Regime de Apuração Tributária pelo SN', 'NFSe/infNFSe/DPS/infDPS/prest/regTrib/ regApTribSN', 10.51, 6.28, 10.19, 0.63, 80],

  // Customer
  ['customerDocument', 'customer', 'CNPJ / CPF / NIF', 'NFSe/infNFSe/DPS/infDPS/toma/ CNPJ / CPF / NIF', 5.41, 6.92, 5.09, 0.63, 40],
  ['customerMunicipalRegistration', 'customer', 'Indicador Municipal (Inscrição)', 'NFSe/infNFSe/DPS/infDPS/toma/ IM', 10.51, 6.92, 5.09, 0.63, 15],
  ['customerPhone', 'customer', 'Telefone', 'NFSe/infNFSe/DPS/infDPS/toma/ fone', 15.62, 6.92, 5.09, 0.63, 20],
  ['customerName', 'customer', 'Nome / Nome Empresarial', 'NFSe/infNFSe/DPS/infDPS/toma/ xNome', 0.3, 7.56, 10.19, 0.63, 80],
  ['customerCity', 'customer', 'Município / Sigla UF', 'NFSe/infNFSe/DPS/infDPS/toma/end/endNac/ ou NFSe/infNFSe/DPS/infDPS/toma/end/endExt/ cMun ou xCidade', 10.51, 7.56, 5.09, 0.63, 37],
  ['customerPostalCode', 'customer', 'Código IBGE / CEP', 'NFSe/infNFSe/DPS/infDPS/toma/end/endNac/ ou NFSe/infNFSe/DPS/infDPS/toma/end/endExt/ cMun + CEP ou cEndPost', 15.62, 7.56, 5.09, 0.63, 21],
  ['customerAddress', 'customer', 'Endereço', 'NFSe/infNFSe/DPS/infDPS/toma/end/ xLgr, nro, xCpl, xBairro', 0.3, 8.22, 10.19, 0.63, 80],
  ['customerEmail', 'customer', 'E-mail', 'NFSe/infNFSe/DPS/infDPS/toma/ email', 10.51, 8.22, 10.19, 0.63, 80],

  // Recipient
  ['recipientDocument', 'recipient', 'CNPJ / CPF / NIF', 'NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/ CNPJ / CPF / NIF', 5.41, 8.86, 5.09, 0.63, 40],
  ['recipientPhone', 'recipient', 'Telefone', 'NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/ fone', 15.62, 8.86, 5.09, 0.63, 20],
  ['recipientName', 'recipient', 'Nome / Nome Empresarial', 'NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/ xNome', 0.3, 9.5, 10.19, 0.63, 80],
  ['recipientCity', 'recipient', 'Município / Sigla UF', 'NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/endNac/ ou NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/endExt/ cMun ou xCidade', 10.51, 9.5, 5.09, 0.63, 37],
  ['recipientPostalCode', 'recipient', 'Código IBGE / CEP', 'NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/endNac/ ou NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/endExt/ cMun + CEP ou cEndPost', 15.62, 9.5, 5.09, 0.63, 21],
  ['recipientAddress', 'recipient', 'Endereço', 'NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/end/ xLgr, nro, xCpl, xBairro', 0.3, 10.16, 10.19, 0.63, 80],
  ['recipientEmail', 'recipient', 'E-mail', 'NFSe/infNFSe/DPS/infDPS/IBSCBS/dest/ email', 10.51, 10.16, 10.19, 0.63, 80],

  // Intermediary
  ['intermediaryDocument', 'intermediary', 'CNPJ / CPF / NIF', 'NFSe/infNFSe/DPS/infDPS/interm/ CNPJ / CPF / NIF', 5.41, 10.8, 5.09, 0.63, 40],
  ['intermediaryMunicipalRegistration', 'intermediary', 'Indicador Municipal (Inscrição)', 'NFSe/infNFSe/DPS/infDPS/interm/ IM', 10.51, 10.8, 5.09, 0.63, 15],
  ['intermediaryPhone', 'intermediary', 'Telefone', 'NFSe/infNFSe/DPS/infDPS/interm/ fone', 15.62, 10.8, 5.09, 0.63, 20],
  ['intermediaryName', 'intermediary', 'Nome / Nome Empresarial', 'NFSe/infNFSe/DPS/infDPS/interm/ xNome', 0.3, 11.44, 10.19, 0.63, 80],
  ['intermediaryCity', 'intermediary', 'Município / Sigla UF', 'NFSe/infNFSe/DPS/infDPS/interm/end/endNac/ ou NFSe/infNFSe/DPS/infDPS/interm/end/endExt/ cMun ou xCidade', 10.51, 11.44, 5.09, 0.63, 37],
  ['intermediaryPostalCode', 'intermediary', 'Código IBGE / CEP', 'NFSe/infNFSe/DPS/infDPS/interm/end/endNac/ ou NFSe/infNFSe/DPS/infDPS/interm/end/endExt/ cMun + CEP ou cEndPost', 15.62, 11.44, 5.09, 0.63, 21],
  ['intermediaryAddress', 'intermediary', 'Endereço', 'NFSe/infNFSe/DPS/infDPS/interm/end/ xLgr, nro, xCpl, xBairro', 0.3, 12.09, 10.19, 0.63, 80],
  ['intermediaryEmail', 'intermediary', 'E-mail', 'NFSe/infNFSe/DPS/infDPS/interm/ email', 10.51, 12.09, 10.19, 0.63, 80],

  // Service
  ['serviceTaxCode', 'service', 'Código de Tributação Nacional / Municipal', 'NFSe/infNFSe/DPS/infDPS/serv/cServ/ + NFSe/infNFSe/ cTribNac + cTribMun', 5.41, 12.74, 5.09, 0.63, 14],
  ['serviceNbs', 'service', 'Código da NBS', 'NFSe/infNFSe/DPS/infDPS/serv/cServ/ cNBS', 10.51, 12.74, 5.09, 0.63, 9],
  ['serviceLocation', 'service', 'Local da Prestação / Sigla UF / País', 'NFSe/infNFSe/ + NFSe/infNFSe/DPS/infDPS/serv/locPrest/ xLocPrestacao + cPaisPrestacao', 15.62, 12.74, 5.09, 0.63, 42],
  ['serviceTaxCodeDescription', 'service', 'Descrição do Código de Tributação Nacional / Municipal', 'NFSe/infNFSe/DPS/infDPS/serv/cServ/ + NFSe/infNFSe/ xTribNac + xTribMun', 0.3, 13.39, 20.4, 0.38, 170],
  ['serviceDescription', 'service', 'Descrição do Serviço', 'NFSe/infNFSe/DPS/infDPS/serv/cServ/ xDescServ', 0.3, 13.79, 20.4, 0.63, 1300],

  // ISSQN
  ['issqnTaxation', 'issqn', 'Tipo de Tributação do ISSQN', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/ tribISSQN', 0.3, 14.43, 5.09, 0.63, 21],
  ['issqnIncidence', 'issqn', 'Município / Sigla UF / País da Incidência do ISSQN', 'NFSe/infNFSe/ + NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/ xLocIncid + cPaisResult', 5.41, 14.43, 10.19, 0.63, 42],
  ['issqnSpecialRegime', 'issqn', 'Regime Especial de Tributação do ISSQN', 'NFSe/infNFSe/DPS/infDPS/prest/regTrib/ regEspTrib', 0.3, 15.08, 5.09, 0.63, 27],
  ['issqnImmunity', 'issqn', 'Tipo de Imunidade do ISSQN', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/ tpImunidade', 5.41, 15.08, 5.09, 0.63, 40],
  ['issqnSuspension', 'issqn', 'Suspensão da Exigibilidade do ISSQN', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/exigSusp/ tpSusp', 10.51, 15.08, 5.09, 0.63, 40],
  ['issqnSuspensionProcess', 'issqn', 'Número Processo Suspensão', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/exigSusp/ nProcesso', 15.62, 15.08, 5.09, 0.63, 30],
  ['municipalBenefit', 'issqn', 'Benefício Municipal', 'NFSe/infNFSe/valores/ tpBM', 0.3, 15.73, 5.09, 0.63, 40],
  ['municipalBenefitCalc', 'issqn', 'Cálculo do BM', 'NFSe/infNFSe/valores/ ou NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/BM/ vCalcBM ou vRedBCBM', 5.41, 15.73, 5.09, 0.63],
  ['deductions', 'issqn', 'Total Deduções/Reduções', 'NFSe/infNFSe/DPS/infDPS/valores/vDedRed/ ou NFSe/infNFSe/valores/ + NFSe/infNFSe/IBSCBS/valores/ vDR ou vCalcDR + vCalcReeRepRes', 10.51, 15.73, 5.09, 0.63],
  ['issqnUnconditionalDiscount', 'issqn', 'Desconto Incondicionado', 'NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/ vDescIncond', 15.62, 15.73, 5.09, 0.63],
  ['issqnBase', 'issqn', 'BC ISSQN', 'NFSe/infNFSe/valores/ vBC', 0.3, 16.37, 5.09, 0.63],
  ['issqnRate', 'issqn', 'Alíquota Aplicada', 'NFSe/infNFSe/valores/ pAliqAplic', 5.41, 16.37, 5.09, 0.63],
  ['issqnWithholding', 'issqn', 'Retenção do ISSQN', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/ tpRetISSQN', 10.51, 16.37, 5.09, 0.63, 25],
  ['issqnAmount', 'issqn', 'ISSQN Apurado', 'NFSe/infNFSe/valores/ vISSQN', 15.62, 16.37, 5.09, 0.63],

  // Federal
  ['irrf', 'federal', 'IRRF', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/ vRetIRRF', 5.41, 17.02, 5.09, 0.63],
  ['socialSecurityWithheld', 'federal', 'Contribuição Previdenciária - Retida', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/ vRetCP', 10.51, 17.02, 5.09, 0.63],
  ['socialContributionsWithheld', 'federal', 'Contribuições Sociais - Retidas', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/ ou tribFed/ + tribFed/piscofins/ + tribFed/piscofins/ vRetCSLL ou vRetCSLL + vPis + vCofins', 15.62, 17.02, 5.09, 0.63],
  ['pisAmount', 'federal', 'PIS - Débito Apuração Própria', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/ vPis', 0.3, 17.67, 5.09, 0.63],
  ['cofinsAmount', 'federal', 'COFINS - Débito Apuração Própria', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/ vCofins', 5.41, 17.67, 5.09, 0.63],
  ['socialContributionsDescription', 'federal', 'Descrição Contrib. Sociais - Retidas', 'NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/ tpRetPisCofins', 10.51, 17.67, 10.19, 0.63, 35],

  // IBS / CBS
  ['ibsCbsClassification', 'ibsCbs', 'CST / cClassTrib', 'NFSe/infNFSe/DPS/infDPS/IBSCBS/valores/trib/gIBSCBS/ CST + cClassTrib', 5.41, 18.32, 5.09, 0.63, 12],
  ['ibsCbsOperation', 'ibsCbs', 'Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF', 'NFSe/infNFSe/DPS/infDPS/IBSCBS/ + NFSe/infNFSe/IBSCBS/ + NFSe/infNFSe/IBSCBS/ cIndOp + cLocalidadeIncid + xLocalidadeIncid', 10.51, 18.32, 10.19, 0.63, 56],
  ['ibsCbsExclusions', 'ibsCbs', 'Exclusões e Reduções da Base de Cálculo', 'NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/ + NFSe/infNFSe/IBSCBS/valores/ + NFSe/infNFSe/valores/ + tribFed/piscofins/ vDescIncond + vCalcReeRepRes + vISSQN + vPIS + vCOFINS', 0.3, 18.96, 5.09, 0.63],
  ['ibsCbsBase', 'ibsCbs', 'Base de Cálculo Após Exclusões e Reduções', 'NFSe/infNFSe/IBSCBS/valores/ vBC', 5.41, 18.96, 5.09, 0.63],
  ['ibsCbsRateReductions', 'ibsCbs', 'Red. Alíquota IBS / Red. Alíquota CBS', 'NFSe/infNFSe/IBSCBS/valores/uf/ + mun/ + fed/ pRedAliqUF + pRedAliqMun + pRedAliqCBS', 10.51, 18.96, 5.09, 0.63],
  ['ibsRates', 'ibsCbs', 'Alíquota - IBS UF / IBS Mun', 'NFSe/infNFSe/IBSCBS/valores/uf/ + mun/ pIBSUF + pIBSMun', 15.62, 18.96, 5.09, 0.63],
  ['ibsMunicipalEffectiveRate', 'ibsCbs', 'Alíq. Efetiva Municipal - IBS', 'NFSe/infNFSe/IBSCBS/valores/mun/ pAliqEfetMun', 0.3, 19.61, 5.09, 0.63],
  ['ibsMunicipalAmount', 'ibsCbs', 'Valor Apurado Municipal - IBS', 'NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSMunTot/ vIBSMun', 5.41, 19.61, 5.09, 0.63],
  ['ibsStateEffectiveRate', 'ibsCbs', 'Alíq. Efetiva Estadual - IBS', 'NFSe/infNFSe/IBSCBS/valores/uf/ pAliqEfetUF', 10.51, 19.61, 5.09, 0.63],
  ['ibsStateAmount', 'ibsCbs', 'Valor Apurado Estadual - IBS', 'NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSUFTot/ vIBSUF', 15.62, 19.61, 5.09, 0.63],
  ['ibsTotalAmount', 'ibsCbs', 'Valor Total Apurado - IBS', 'NFSe/infNFSe/IBSCBS/totCIBS/gIBS/ vIBSTot', 0.3, 20.26, 5.09, 0.63],
  ['cbsRate', 'ibsCbs', 'Alíquota - CBS', 'NFSe/infNFSe/IBSCBS/valores/fed/ pCBS', 5.41, 20.26, 5.09, 0.63],
  ['cbsEffectiveRate', 'ibsCbs', 'Alíquota Efetiva - CBS', 'NFSe/infNFSe/IBSCBS/valores/fed/ pAliqEfetCBS', 10.51, 20.26, 5.09, 0.63],
  ['cbsAmount', 'ibsCbs', 'Valor Total Apurado - CBS', 'NFSe/infNFSe/IBSCBS/totCIBS/gCBS/ vCBS', 15.62, 20.26, 5.09, 0.63],

  // Total
  ['serviceAmount', 'total', 'Valor da Operação / Serviço', 'NFSe/infNFSe/DPS/infDPS/valores/vServPrest/ vServ', 5.41, 20.9, 5.09, 0.67],
  ['totalUnconditionalDiscount', 'total', 'Desconto Incondicionado', 'NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/ vDescIncond', 10.51, 20.9, 5.09, 0.67],
  ['conditionalDiscount', 'total', 'Desconto Condicionado', 'NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/ vDescCond', 15.62, 20.9, 5.09, 0.67],
  ['totalWithholdings', 'total', 'Total das Retenções (ISSQN / Federais)', 'NFSe/infNFSe/valores/ vTotalRet', 0.3, 21.59, 5.09, 0.67],
  ['netAmount', 'total', 'Valor Líquido da NFS-e', 'NFSe/infNFSe/valores/ vLiq', 5.41, 21.59, 5.09, 0.67],
  ['ibsCbsTotal', 'total', 'Total do IBS/CBS', 'NFSe/infNFSe/IBSCBS/totCIBS/gIBS/ + NFSe/infNFSe/IBSCBS/totCIBS/gCBS/ vIBSTot + vCBS', 10.51, 21.59, 5.09, 0.67],
  ['netAmountWithIbsCbs', 'total', 'Valor Líquido da NFS-e + IBS/CBS', 'NFSe/infNFSe/IBSCBS/totCIBS/ vTotNF', 15.62, 21.59, 5.09, 0.67],

  // Complementary
  ['complementaryInfo', 'complementary', 'Informações Complementares', 'NFSe/infNFSe/DPS/infDPS/serv/infoCompl/ xInfComp + chSubstda + docRef + cObra + inscImobFisc + idAtvEvt + idDocTec + xPed + xItemPed + xOutInf + totais aproximados dos tributos', 0.3, 22.68, 20.4, 0.39, 2000],
] as const satisfies readonly (readonly [string, BlockKey, string, string, number, number, number, number, number?])[];

export type FieldKey = (typeof ROWS)[number][0];

export interface LayoutField {
  key: FieldKey;
  block: BlockKey;
  label: string;
  xmlPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  maxChars?: number;
}

export const FIELDS: readonly LayoutField[] = ROWS.map((r) => {
  const [key, block, label, xmlPath, x, y, width, height] = r;
  const maxChars = r.length === 9 ? r[8] : undefined;
  return maxChars === undefined
    ? { key, block, label, xmlPath, x, y, width, height }
    : { key, block, label, xmlPath, x, y, width, height, maxChars };
});
