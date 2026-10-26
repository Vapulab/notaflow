# DANFSe Plan A: Renderer and Download Without the ADN

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Baixar PDF" works again: the server draws the DANFSe from the stored XML to the NT 008 layout, with no call to the ADN.

**Architecture:** A new package `@notaflow/danfse-pdf` turns an NFS-e XML into a one-page A4 PDF with `pdf-lib`. The download route reads the XML from SQLite, picks the watermark from the invoice status and events, and sends the PDF it draws. The ADN DANFSe call and its fake leave the code. Plan B adds the queue, the worker, and R2 on top of this package; Plan C adds the public link and sharing.

**Tech Stack:** TypeScript, `pdf-lib` 1.17.1, `@pdf-lib/fontkit` 1.1.1, `qrcode` 1.5.4, `@xmldom/xmldom` (already used), Vitest, `unpdf` (already used) to read PDFs in tests.

**Spec:** [RFC: DANFSe PDF Generation](../../RFCS/2026/10/RFC_DANFSE_PDF.md), section "The DANFSe Layout". Layout source: NT SE/CGNFS-e nº 008 v1.02.

## Global Constraints

- One page, A4 portrait (595.28 x 841.89 pt). Margins 0.15 cm to 0.20 cm. Page border 1 pt, block lines 0.5 pt, gray 5% fill on the header, block titles, "Emitente da NFS-e", and "Valor Líquido da NFS-e + IBS/CBS" (NT 008 items 2.2 to 2.2.3).
- Field positions and sizes come from NT 008 item 2.4.5. Coordinates in the NT are in cm from the top-left; pdf-lib uses pt from the bottom-left (1 cm = 28.3465 pt).
- Print only data from the XML (NT 008 item 2.1). Nothing from NotaFlow on the page. `Producer` and `Creator` metadata are "NotaFlow".
- Empty field: "-". Text longer than the NT size: cut and end with "..." (NT 008 item 2.1, note 12).
- Fonts: the NT asks for Arial (labels) and Microsoft Sans Serif (content). Neither has a license to embed. Use Liberation Sans Regular and Bold 2.1.5 (SIL OFL, metric-compatible with Arial) for both. This is a known deviation; record it in `packages/danfse-pdf/spec/SOURCE.md`.
- Sizes: block titles 7 pt bold uppercase; field labels 6 pt bold, title case (7 pt bold uppercase in "Dados da NFS-e"); content 7 pt; header title 9 pt bold; municipality 8 pt; environment lines 6 pt.
- QR code: at least 1.52 x 1.52 cm at X 17.48 cm, Y 1.67 cm, URL `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=<accessKey>`. Text below it in 3 lines, 6 pt: "A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e".
- `tpAmb = 2`: "NFS-e SEM VALIDADE JURÍDICA", 9 pt bold, solid red, below "Documento Auxiliar da NFS-e".
- Watermark "CANCELADA" or "SUBSTITUÍDA": diagonal, at least 50 pt, gray K35 (`grayscale(0.65)`).
- No "Canhoto" block (optional, NT 008 item 2.3.3); its height goes to "Descrição do Serviço".
- Project rules: no `!` non-null assertions; amounts are integer cents until formatting; comments one line, only the non-obvious why; scripts run on Windows and Linux; no AI attribution in commits.

## Review Focus

1. **A long service description** (2000 characters) must still give one page; the text is cut with "...". Test in Task 4.
2. **No customer, no recipient, no intermediary, no ISSQN** must print the fixed NT texts (notes 2, 3, 4), not empty boxes. Test in Task 4.
3. **A foreign customer** (NIF, foreign address) must print the NIF and the foreign address. Test in Task 2 with `NFSE_EXPORT.xml`.
4. **An invoice with no stored XML** (rejected, pending) must answer 404 `not_found`, not 500. Test in Task 5.
5. **A substituted invoice** must say "SUBSTITUÍDA", not "CANCELADA". Test in Task 5.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/danfse-pdf/package.json`, `tsconfig.json`, `AGENTS.md` | The package |
| `packages/danfse-pdf/spec/NT_008_v1.02.pdf`, `spec/SOURCE.md` | The vendored NT, its URL and date, the font deviation |
| `packages/danfse-pdf/assets/LiberationSans-Regular.ttf`, `LiberationSans-Bold.ttf`, `LICENSE-LiberationSans.txt`, `nfse-logo.png`, `SOURCE.md` | Fonts and the NFS-e logo, with sources |
| `packages/danfse-pdf/src/layout.ts` | The NT 008 item 2.4.5 table as data |
| `packages/danfse-pdf/src/codes.ts` | Code to description tables (`tpEmit`, `cStat`, `finNFSe`, `ambGer`, `tpAmb`, ISSQN and federal tax codes) |
| `packages/danfse-pdf/src/readDanfseData.ts` | XML to formatted field strings |
| `packages/danfse-pdf/src/draw.ts` | Low-level drawing: boxes, labels, cut text |
| `packages/danfse-pdf/src/renderDanfse.ts` | Page assembly, QR, marks |
| `packages/danfse-pdf/src/markFor.ts` | Invoice status and events to watermark |
| `packages/danfse-pdf/src/index.ts` | Exports |
| `packages/danfse-pdf/scripts/golden.ts` | Writes sample PDFs for a person to check |
| `packages/provider-nacional/src/index.ts` | Export the XML read helpers |
| `apps/server/src/routes/invoices.ts` | The download route |

---

### Task 1: Package and the NT 008 layout table

**Files:**
- Create: `packages/danfse-pdf/package.json`, `tsconfig.json`, `AGENTS.md`, `spec/*`, `assets/*`, `src/layout.ts`, `src/index.ts`
- Test: `packages/danfse-pdf/src/layout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BlockKey = 'header' | 'identification' | 'provider' | 'customer' | 'recipient'
    | 'intermediary' | 'service' | 'issqn' | 'federal' | 'ibsCbs' | 'total' | 'complementary';
  export interface LayoutField {
    key: FieldKey;          // camelCase of the NT field name, for example 'accessKey', 'providerName'
    block: BlockKey;
    label: string;          // the NT field name as printed, for example 'Chave de Acesso da NFS-e'
    xmlPath: string;        // the NT "Caminho no XML" text, kept for traceability
    x: number; y: number; width: number; height: number; // cm, from the NT
    maxChars?: number;      // the NT "Tam. do Campo"
  }
  export interface LayoutBlock { key: BlockKey; title: string; x: number; y: number; width: number; height: number }
  export const BLOCKS: readonly LayoutBlock[];
  export const FIELDS: readonly LayoutField[];
  export type FieldKey = /* union of every key in FIELDS */;
  ```

- [ ] **Step 1: Scaffold the package**

`package.json`: name `@notaflow/danfse-pdf`, `"type": "module"`, `exports: { ".": "./src/index.ts" }`, `scripts.typecheck`, `scripts.golden: "tsx scripts/golden.ts"`, dependencies `pdf-lib` 1.17.1, `@pdf-lib/fontkit` 1.1.1, `qrcode` 1.5.4, `@notaflow/provider-nacional: workspace:*`; devDependencies `@types/qrcode`, `unpdf` 1.8.1. `tsconfig.json` as `packages/core`. Run `pnpm install`.

Download into `spec/` the NT PDF from <https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260714-v1-02.pdf>. Download into `assets/` the Liberation Sans 2.1.5 TTFs and license from <https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5> and the logo from the NT 008 item 2.4.3 link. Write both `SOURCE.md` files with URL and date, and the font deviation. `AGENTS.md` follows `packages/core/AGENTS.md`, and adds the package to the root `AGENTS.md` table.

- [ ] **Step 2: Write the failing test**

```ts
test('blocks follow the NT 008 order', () => {
  expect(BLOCKS.map((b) => b.key)).toEqual(['header', 'identification', 'provider', 'customer',
    'recipient', 'intermediary', 'service', 'issqn', 'federal', 'ibsCbs', 'total', 'complementary']);
});
test('every field fits the A4 page inside the margins', () => {
  for (const f of FIELDS) {
    expect(f.x).toBeGreaterThanOrEqual(0.15);
    expect(f.x + f.width).toBeLessThanOrEqual(21.0 - 0.15);
    expect(f.y + f.height).toBeLessThanOrEqual(29.7 - 0.15);
  }
});
test('keys are unique', () => expect(new Set(FIELDS.map((f) => f.key)).size).toBe(FIELDS.length));
test('the identification block matches NT 008 item 2.4.5', () => {
  expect(FIELDS.find((f) => f.key === 'accessKey')).toMatchObject({ x: 0.3, y: 1.48, width: 15.3, height: 0.77, maxChars: 50 });
  expect(FIELDS.find((f) => f.key === 'nfseNumber')).toMatchObject({ x: 0.3, y: 2.27, width: 5.09, maxChars: 13 });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm vitest run packages/danfse-pdf`
Expected: FAIL, `BLOCKS` is not defined.

- [ ] **Step 4: Write `src/layout.ts`**

Copy every row of NT 008 item 2.4.5 (pages 17 to 21 of the PDF) into `BLOCKS` and `FIELDS`, without the "Canhoto" rows. Use the NT numbers as they are (comma to dot). Block y positions from the NT: identification 1.48, provider 4.34, customer 6.92, recipient 8.86, intermediary 10.80, service 12.74, issqn 14.43, federal 17.02, ibsCbs 18.32, total 20.90, complementary 22.27.

- [ ] **Step 5: Run the test and see it pass**

Run: `pnpm vitest run packages/danfse-pdf` → PASS. Run `pnpm typecheck` → no errors.

- [ ] **Step 6: Commit**

`git commit -m "feat(danfse): add the danfse-pdf package and the NT 008 layout table"`

---

### Task 2: Read the XML into DANFSe fields

**Files:**
- Modify: `packages/provider-nacional/src/index.ts` (export `parseXmlRoot`, `child`, `childElements`, `text`, `requiredText`, `requiredChild` from `./xml/readXml`)
- Create: `packages/danfse-pdf/src/codes.ts`, `packages/danfse-pdf/src/readDanfseData.ts`
- Test: `packages/danfse-pdf/src/readDanfseData.test.ts`

**Interfaces:**
- Consumes: `FieldKey`, `FIELDS` (Task 1); `formatBrasiliaDateTime`, `centsToDecimal`, `decimalToCents` and the read helpers from `@notaflow/provider-nacional`.
- Produces:
  ```ts
  export interface DanfseData {
    fields: Record<FieldKey, string>;   // formatted and cut; '-' when the XML has no value
    accessKey: string;                  // 50 chars, no 'NFS' prefix
    testEnvironment: boolean;           // tpAmb = 2
    customer: 'present' | 'absent';
    recipient: 'present' | 'same' | 'absent';
    intermediary: 'present' | 'absent';
    issqn: 'present' | 'notSubject';
  }
  export function readDanfseData(xml: string): DanfseData;
  ```

- [ ] **Step 1: Write the failing tests**

Use `readFixture` from `packages/provider-nacional/test/fixtures` (import by relative path).

```ts
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
```

Export `formatDocument(type: 'CNPJ' | 'CPF' | 'NIF', value: string): string` from `readDanfseData.ts` for this test.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run packages/danfse-pdf/src/readDanfseData.test.ts` → FAIL.

- [ ] **Step 3: Write `codes.ts` and `readDanfseData.ts`**

`codes.ts`: for each coded field that NT 008 says to print as a description, a `Record<string, string>` built from the `xs:documentation` of the matching enumeration in `packages/provider-nacional/schemas/` (use the NT 009 schemas in `schemas/nt009` when present). An unknown code prints the code itself.

`readDanfseData`: one entry per `FIELDS` key, read from the `xmlPath` of the field. Dates `DD/MM/AAAA`, date-times `DD/MM/AAAA hh:mm:ss` in Brasília time, money `R$ 1.234,56`, CPF `nnn.nnn.nnn-nn`, CNPJ `nn.nnn.nnn/nnnn-nn`. Municipality: `Município: <xLocEmi> / <UF>`, and "-" when the national tax code item is 99. `recipient` is `same` when the XML has no `dest` group, or when `dest` has the same document as `toma`. The "Informações Complementares" field joins the NT order with " | " and always ends with the "Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: ...; Estaduais: ...; Municipais: ..." line from the `totTrib` group (note 10). Cut it at 1997 characters plus "..." before that line.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm vitest run packages/danfse-pdf` → PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(danfse): read the NFS-e XML into DANFSe fields"`

---

### Task 3: Draw the page frame, header, identification, and QR code

**Files:**
- Create: `packages/danfse-pdf/src/draw.ts`, `packages/danfse-pdf/src/renderDanfse.ts`, `packages/danfse-pdf/src/pdfText.test-util.ts`
- Test: `packages/danfse-pdf/src/renderDanfse.test.ts`

**Interfaces:**
- Consumes: `readDanfseData`, `DanfseData` (Task 2); `BLOCKS`, `FIELDS` (Task 1).
- Produces:
  ```ts
  export type DanfseMark = 'none' | 'cancelada' | 'substituida';
  export function renderDanfse(xml: string, options: { mark: DanfseMark }): Promise<Uint8Array>;
  // test helper in pdfText.test-util.ts
  export function pdfFacts(pdf: Uint8Array): Promise<{ pages: number; width: number; height: number; text: string; producer: string | undefined }>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('one A4 portrait page with NotaFlow metadata', async () => {
  const f = await pdfFacts(await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' }));
  expect(f.pages).toBe(1);
  expect(f.width).toBeCloseTo(595.28, 1);
  expect(f.height).toBeCloseTo(841.89, 1);
  expect(f.producer).toBe('NotaFlow');
});
test('header and identification', async () => {
  const { text } = await pdfFacts(await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' }));
  expect(text).toContain('DANFSe v2.0');
  expect(text).toContain('Documento Auxiliar da NFS-e');
  expect(text).toContain('35503082212345678000195000000000004226100000000420');
  expect(text).toContain('A autenticidade desta NFS-e');
});
test('test environment prints SEM VALIDADE JURÍDICA; production does not', async () => {
  expect((await pdfFacts(await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' }))).text).toContain('NFS-e SEM VALIDADE JURÍDICA');
  expect((await pdfFacts(await renderDanfse(readFixture('NFSE_EXPORT.xml'), { mark: 'none' }))).text).not.toContain('SEM VALIDADE');
});
```

`pdfFacts` uses `PDFDocument.load` from `pdf-lib` for the page count, size, and producer, and `extractText` from `unpdf` for the text.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run packages/danfse-pdf/src/renderDanfse.test.ts` → FAIL.

- [ ] **Step 3: Write `draw.ts` and the first part of `renderDanfse.ts`**

`draw.ts` exports `cm(value: number): number`, `box(page, x, y, w, h, opts: { fill?: boolean; lineWidth: 0.5 | 1 })` (NT top-left cm to pdf-lib bottom-left pt), and `fitText(font, text, size, maxWidthPt): string` that cuts with "..." when the text is wider than the box. `renderDanfse` registers fontkit, embeds the two fonts and the logo, sets `Producer` and `Creator` to "NotaFlow", draws the page border, the header (logo, the centered title, municipality, `ambGer`, `tpAmb`), the identification block, and the QR code (`QRCode.toBuffer(url, { type: 'png', margin: 0 })`, drawn at 1.52 cm).

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm vitest run packages/danfse-pdf` → PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(danfse): draw the DANFSe frame, header, identification, and QR code"`

---

### Task 4: Draw the other blocks, the fixed texts, and the watermarks

**Files:**
- Modify: `packages/danfse-pdf/src/renderDanfse.ts`
- Create: `packages/danfse-pdf/src/markFor.ts`, `packages/danfse-pdf/scripts/golden.ts`
- Test: `packages/danfse-pdf/src/renderDanfse.test.ts`, `packages/danfse-pdf/src/markFor.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  ```ts
  // 105102 is the cancellation-by-substitution event (see CANCELLING_EVENTS in InvoiceRepository).
  export function markFor(status: string, eventCodes: readonly string[]): DanfseMark;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('markFor', () => {
  expect(markFor('issued', [])).toBe('none');
  expect(markFor('cancelled', ['101101'])).toBe('cancelada');
  expect(markFor('cancelled', ['105102'])).toBe('substituida');
});
test('watermarks', async () => {
  const xml = readFixture('NFSE_DOMESTIC.xml');
  expect((await pdfFacts(await renderDanfse(xml, { mark: 'cancelada' }))).text).toContain('CANCELADA');
  expect((await pdfFacts(await renderDanfse(xml, { mark: 'substituida' }))).text).toContain('SUBSTITUÍDA');
  expect((await pdfFacts(await renderDanfse(xml, { mark: 'none' }))).text).not.toMatch(/CANCELADA|SUBSTITUÍDA/);
});
test('fixed texts for absent blocks', async () => {
  const xml = readFixture('NFSE_DOMESTIC.xml').replace(/<toma>[\s\S]*?<\/toma>/, '');
  const { text } = await pdfFacts(await renderDanfse(xml, { mark: 'none' }));
  expect(text).toContain('TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');
  expect(text).toContain('INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');
});
test('ISSQN not applicable prints the fixed text', async () => {
  const { text } = await pdfFacts(await renderDanfse(readFixture('NFSE_EXPORT.xml'), { mark: 'none' }));
  expect(text).toContain('TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN');
});
test('a 2000-character description stays on one page', async () => {
  const xml = readFixture('NFSE_DOMESTIC.xml').replace(/<xDescServ>[^<]*<\/xDescServ>/, `<xDescServ>${'Serviço '.repeat(250)}</xDescServ>`);
  const f = await pdfFacts(await renderDanfse(xml, { mark: 'none' }));
  expect(f.pages).toBe(1);
  expect(f.text).toContain('...');
});
test('tax totals line is always present', async () => {
  const { text } = await pdfFacts(await renderDanfse(readFixture('NFSE_DOMESTIC.xml'), { mark: 'none' }));
  expect(text).toContain('Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run packages/danfse-pdf` → FAIL.

- [ ] **Step 3: Implement**

Draw each block from `BLOCKS` and `FIELDS`. An absent block draws only its fixed text in a box of height 0.32 cm and width 20.40 cm (NT notes 2, 3, 4), and the blocks below move up; the height saved goes to "Descrição do Serviço" (NT 008 items 2.3.1 to 2.3.3), together with the Canhoto height. Long texts wrap inside their box and cut with "..." on the last line that fits. The watermark: Liberation Sans 60 pt, `grayscale(0.65)`, rotated 45 degrees, centered, drawn last. `markFor` lives in `markFor.ts`.

`scripts/golden.ts` writes `packages/danfse-pdf/golden/<fixture>-<mark>.pdf` for each fixture and mark. Add `golden/` to `.gitignore`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm vitest run packages/danfse-pdf` → PASS.

- [ ] **Step 5: Check by eye**

Run: `pnpm --filter @notaflow/danfse-pdf golden`. Open the PDFs next to the NT 008 Anexo I model. Compare the block order, the gray fills, the QR position, and the watermark. Fix what differs.

- [ ] **Step 6: Commit**

`git commit -m "feat(danfse): draw every DANFSe block, fixed texts, and watermarks"`

---

### Task 5: The download route draws the PDF

**Files:**
- Modify: `apps/server/src/routes/invoices.ts:93-120`, `apps/server/package.json` (add `@notaflow/danfse-pdf: workspace:*`)
- Test: `apps/server/src/routes/invoices.test.ts` (replace the ADN cases around lines 165-220)

**Interfaces:**
- Consumes: `renderDanfse`, `markFor` (Tasks 3, 4); `invoices.get(ctx, id)` (returns `status`, `number`, `events[].code`) and `invoices.xml(ctx, id)` from `InvoiceRepository`.

- [ ] **Step 1: Write the failing tests**

```ts
test('the route draws the DANFSe from the stored XML', async () => {
  // a synced invoice with XML, as the existing tests set it up
  const response = await t.app.inject({ method: 'GET', url: `/api/accounts/${a.accountId}/invoices/${id}/danfse` });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('application/pdf');
  expect(response.headers['content-disposition']).toMatch(/^attachment; filename="DANFSe-\w+\.pdf"$/);
  expect((await pdfFacts(response.rawPayload)).pages).toBe(1);
});
test('an invoice with no XML answers 404 not_found', ...);         // a rejected invoice
test('an invoice of another account answers 404 not_found', ...);  // keep the existing case
test('a cancelled invoice prints CANCELADA', ...);
test('an invoice with event 105102 prints SUBSTITUÍDA', ...);
test('the route works without an active certificate', ...);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run apps/server/src/routes/invoices.test.ts` → FAIL.

- [ ] **Step 3: Implement**

The route: `invoices.get` (404 when missing), `invoices.xml` (404 `not_found` when null), `renderDanfse(xml, { mark: markFor(invoice.status, invoice.events.map((e) => e.code)) })`, the same headers as today. Remove the certificate load and the provider call. A render error is a 500 that Sentry gets; do not map it to `danfse_unavailable`.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm vitest run apps/server` → PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(server): draw the DANFSe from the stored XML instead of the ADN"`

---

### Task 6: Remove the ADN DANFSe path and update the docs

**Files:**
- Modify: `packages/core/src/ports/InvoiceProvider.ts:19-20` (remove `getDanfse`), `packages/provider-nacional/src/NacionalProvider.ts:29-31`, `packages/provider-nacional/src/http/NacionalClient.ts:186` and its tests, `packages/fake-nacional/src/startFakeNacional.ts:11,92,150` and its tests, `apps/web/src/download.ts` (`danfseErrorText`), `apps/web/src/components/Layout.tsx:122`, `apps/web/src/pages/*` tests that stub `danfse_unavailable`
- Modify docs: `docs/ENGINEERING/ARCHITECTURE/diagrams/c4-3-server-components.mmd` and its PNG (the DANFSe now comes from the renderer, not from the ADN), `packages/provider-nacional/AGENTS.md`, `apps/server/AGENTS.md`

- [ ] **Step 1: Remove the code**

Remove `getDanfse` from the port, the provider, the client, and the fake route `danfse`. In the web, `danfseErrorText` becomes `errorText`; remove `ERROR_TEXT.danfse_unavailable`. Run `pnpm typecheck` and fix each place it reports.

- [ ] **Step 2: Run the whole suite**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass, and `grep -rn "getDanfse\|danfse_unavailable" apps packages` finds nothing.

- [ ] **Step 3: Update the diagram and the docs**

Change the server components diagram so the PDF comes from `@notaflow/danfse-pdf`. Render the PNG as `docs/ENGINEERING/ARCHITECTURE/diagrams/README.md` says. Add a line on the package to `apps/server/AGENTS.md`.

- [ ] **Step 4: Commit**

`git commit -m "refactor: remove the suspended ADN DANFSe path"`

---

## Follow-up plans

- **Plan B:** queue `danfse` (Redis + BullMQ), the `danfse-worker` container, the R2 bucket, `pdf_status`, the "Gerando PDF…" state, the backfill, metrics and alerts, C4 containers and deployment diagrams.
- **Plan C:** `invoice_links`, `/n/<token>`, "Copiar link", "Compartilhar", the NotaFlow e-mail (manual and automatic), PostHog events.
