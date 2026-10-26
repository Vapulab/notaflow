import { expect, test } from 'vitest';
import { readFixture } from '../../provider-nacional/test/fixtures';
import { FIELDS } from './layout';
import { formatDocument, readDanfseData } from './readDanfseData';

test('domestic invoice: identification and parties', () => {
  const d = readDanfseData(readFixture('NFSE_DOMESTIC.xml'));
  expect(d.accessKey).toBe('35503082212345678000195000000000004226100000000420');
  expect(d.testEnvironment).toBe(true);
  expect(d.fields.nfseNumber).toBe('42');
  expect(d.fields.competence).toBe('30/09/2026');
  expect(d.fields.providerDocument).toBe('12.345.678/0001-95');
  expect(d.fields.customerDocument).toBe('98.765.432/0001-10');
  expect(d.fields.customerName).toBe('Cliente Exemplo & Filhos Ltda');
  expect(d.fields.serviceAmount).toBe('R$ 1.500,00');
  expect(d.customer).toBe('present');
});
test('foreign customer prints the NIF and the foreign address', () => {
  const d = readDanfseData(readFixture('NFSE_EXPORT.xml'));
  expect(d.fields.customerDocument).toBe('00-0000000');
  expect(d.fields.customerName).toBe('Foreign Customer Inc');
  expect(d.testEnvironment).toBe(false);
});
test('a missing optional value prints a dash', () => {
  const d = readDanfseData(readFixture('NFSE_EXPORT.xml'));
  expect(d.fields.issqnAmount).toBe('-');
});
test('a text longer than the NT size ends with "..."', () => {
  const xml = readFixture('NFSE_DOMESTIC.xml').replace(/<xNome>EMPRESA TESTE LTDA<\/xNome>/, `<xNome>${'A'.repeat(120)}</xNome>`);
  const name = readDanfseData(xml).fields.providerName;
  expect(name).toHaveLength(80);
  expect(name.endsWith('...')).toBe(true);
});
test('no toma gives customer "absent"', () => {
  const xml = readFixture('NFSE_DOMESTIC.xml').replace(/<toma>[\s\S]*?<\/toma>/, '');
  expect(readDanfseData(xml).customer).toBe('absent');
});
test('a CNPJ with letters keeps its mask', () => {
  // NT 009: CNPJ becomes [0-9A-Z]{14}; the mask is the same.
  expect(formatDocument('CNPJ', '12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
});

test('every layout key has a string, and the renderer-drawn keys are empty', () => {
  const d = readDanfseData(readFixture('NFSE_DOMESTIC.xml'));
  for (const f of FIELDS) expect(typeof d.fields[f.key]).toBe('string');
  expect(d.fields.logo).toBe('');
  expect(d.fields.qrCode).toBe('');
  expect(d.fields.documentTitle).toBe('');
  expect(d.fields.qrCaption).toBe('');
});
test('domestic invoice: dates, municipality, codes and money', () => {
  const d = readDanfseData(readFixture('NFSE_DOMESTIC.xml')).fields;
  expect(d.nfseIssuedAt).toBe('01/10/2026 10:00:00');
  expect(d.municipality).toBe('Município: São Paulo / SP');
  expect(d.environmentType).toBe('Homologação');
  expect(d.issuerType).toBe('Prestador');
  expect(d.nfseStatus).toBe('NFS-e Gerada');
  expect(d.providerSimplesNacional).toBe('Não Optante');
  expect(d.issqnTaxation).toBe('Operação tributável');
  expect(d.issqnWithholding).toBe('Não Retido');
  expect(d.serviceTaxCode).toBe('01.01.01');
  expect(d.serviceNbs).toBe('1.1502.20.00');
  expect(d.issqnAmount).toBe('R$ 30,00');
  expect(d.netAmount).toBe('R$ 1.470,00');
  expect(d.customerPostalCode).toBe('3550308 / 01.310-100');
  expect(d.customerAddress).toBe('Av. Paulista, 1000, Sala 1, Bela Vista');
});
test('an unknown code prints the code itself', () => {
  const xml = readFixture('NFSE_DOMESTIC.xml').replace('<tpEmit>1</tpEmit>', '<tpEmit>7</tpEmit>');
  expect(readDanfseData(xml).fields.issuerType).toBe('7');
});
test('foreign customer: city and postal code come from the foreign address', () => {
  const d = readDanfseData(readFixture('NFSE_EXPORT.xml')).fields;
  expect(d.customerCity).toBe('Testville / NY');
  expect(d.customerPostalCode).toBe('99999');
  expect(d.issqnIncidence).toBe('Estados Unidos');
});
test('the municipality is hidden when the national tax code item is 99', () => {
  const xml = readFixture('NFSE_DOMESTIC.xml').replace('<cTribNac>010101</cTribNac>', '<cTribNac>990101</cTribNac>');
  expect(readDanfseData(xml).fields.municipality).toBe('-');
});
test('block switches follow the XML', () => {
  const domestic = readDanfseData(readFixture('NFSE_DOMESTIC.xml'));
  expect(domestic.recipient).toBe('same');
  expect(domestic.intermediary).toBe('absent');
  expect(domestic.issqn).toBe('present');
  expect(readDanfseData(readFixture('NFSE_EXPORT.xml')).issqn).toBe('present');
  const notIncident = readFixture('NFSE_DOMESTIC.xml').replace('<tribISSQN>1</tribISSQN>', '<tribISSQN>4</tribISSQN>');
  expect(readDanfseData(notIncident).issqn).toBe('notSubject');
});
test('a dest with another document is present; the same document is "same"', () => {
  const dest = (cnpj: string): string => `<IBSCBS><dest><CNPJ>${cnpj}</CNPJ><xNome>Destino</xNome></dest></IBSCBS>`;
  const base = readFixture('NFSE_DOMESTIC.xml');
  const other = readDanfseData(base.replace('</infDPS>', `${dest('11222333000181')}</infDPS>`));
  expect(other.recipient).toBe('present');
  expect(other.fields.recipientDocument).toBe('11.222.333/0001-81');
  expect(readDanfseData(base.replace('</infDPS>', `${dest('98765432000110')}</infDPS>`)).recipient).toBe('same');
});
test('the complementary info always ends with the approximate taxes line', () => {
  const d = readDanfseData(readFixture('NFSE_EXPORT.xml')).fields;
  expect(d.complementaryInfo).toBe('Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Simples Nacional: 6,00%');
});
test('the complementary info joins the NT order with " | " and cuts before the taxes line', () => {
  const base = readFixture('NFSE_DOMESTIC.xml');
  const xml = base
    .replace('</toma><serv>', `</toma><subst><chSubstda>${'1'.repeat(50)}</chSubstda><cMotivo>01</cMotivo></subst><serv>`)
    .replace('</cServ>', '</cServ><infoCompl><xInfComp>Pedido 10</xInfComp></infoCompl>');
  expect(readDanfseData(xml).fields.complementaryInfo.startsWith('Pedido 10 | NFS-e Subst.: ')).toBe(true);
  const long = base.replace('</cServ>', `</cServ><infoCompl><xInfComp>${'x'.repeat(2500)}</xInfComp></infoCompl>`);
  expect(readDanfseData(long).fields.complementaryInfo.startsWith(`${'x'.repeat(1997)}... | Totais Aproximados`)).toBe(true);
});
test('the export invoice with IBS/CBS prints the CST and the finality', () => {
  const d = readDanfseData(readFixture('NFSE_EXPORT_FULL.xml')).fields;
  expect(d.ibsCbsClassification).toBe('410 / 410027');
  expect(d.purpose).toBe('NFS-e regular');
  expect(d.ibsCbsOperation).toBe('100302');
});
test('a municipality outside the issuer city prints the official name and UF', () => {
  const xml = readFixture('NFSE_DOMESTIC.xml').replace('<endNac><cMun>3550308</cMun>', '<endNac><cMun>4113700</cMun>');
  const d = readDanfseData(xml).fields;
  expect(d.customerCity).toBe('Londrina / PR');
  expect(d.customerPostalCode).toBe('4113700 / 01.310-100');
});
test('the service location and the incidence print municipality and country names', () => {
  const xml = readFixture('NFSE_DOMESTIC.xml')
    .replace('<cLocPrestacao>3550308</cLocPrestacao>', '<cLocPrestacao>3304557</cLocPrestacao>')
    .replace('<tribISSQN>1</tribISSQN>', '<tribISSQN>3</tribISSQN><cPaisResult>US</cPaisResult>');
  const d = readDanfseData(xml).fields;
  expect(d.serviceLocation).toBe('Rio de Janeiro / RJ');
  expect(d.issqnIncidence).toBe('Estados Unidos');
});
test('the municipal benefit prints the real value from the XML', () => {
  const bm = (type: string, inner: string): string =>
    readFixture('NFSE_DOMESTIC.xml')
      .replace('<valores><vISSQN>', '<valores><tpBM>' + type + '</tpBM><vISSQN>')
      .replace('</tribMun>', `${inner}</tribMun>`);
  const pct = readDanfseData(bm('2', '<BM><nBM>1</nBM><pRedBCBM>10.00</pRedBCBM></BM>')).fields.municipalBenefit;
  expect(pct).toBe('Redução da BC em 10,00%');
  const amount = readDanfseData(bm('3', '<BM><nBM>1</nBM><vRedBCBM>25.50</vRedBCBM></BM>')).fields.municipalBenefit;
  expect(amount).toBe('Redução da BC em R$ 25,50');
  expect(readDanfseData(bm('4', '<pAliq>2.50</pAliq>')).fields.municipalBenefit).toBe('Alíquota Diferenciada de 2,50%');
  expect(readDanfseData(bm('1', '')).fields.municipalBenefit).toBe('Isenção');
});
