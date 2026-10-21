# RFC: Accounting Guide

**Status:** Approved in design (2026-10-21)
**Date:** 2026-10-21
**Owner:** Lincoln Santos (Vapulab)

**References:**

- [Onboarding](../../../ARCHITECTURE/ONBOARDING.md) (the certificate step, where users stop today)
- [New Invoice RFC](RFC_NEW_INVOICE.md) (the fields that the guide explains)
- [Lifecycle E-mails RFC](RFC_LIFECYCLE_EMAILS.md) (the certificate reminder copy)
- [Accounting Guide Sources](RFC_ACCOUNTING_GUIDE_SOURCES.md) (each fact with its official source, checked on 2026-10-21)
- [Data](../../../CONVENTIONS/DATA.md) and [Writing Style](../../../CONVENTIONS/WRITING_STYLE.md)
- `apps/web/AGENTS.md` rule 10 (how to add a public page)

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Goals, Non-goals, Anti-goals](#goals-non-goals-anti-goals)
4. [Solution](#solution)
5. [Design](#design)
6. [Content](#content)
7. [Sources and Accuracy](#sources-and-accuracy)
8. [Data Model](#data-model)
9. [File Locations](#file-locations)
10. [Testing](#testing)
11. [Builder Calls](#builder-calls)

---

## Overview

A public guide at `/guia` teaches a person with no accounting knowledge to issue their own service invoices with confidence. It explains the digital certificate, when an accountant is necessary, how to find the correct tax rate, and how to fill each field of the invoice in NotaFlow. The guide opens with one question, "Qual é o tipo da sua empresa?", and gives one path for each regime: MEI, Simples Nacional (ME/EPP), and Lucro Presumido. A rate calculator shows the person the correct Simples rate for their company.

Every page cites the official source of each rule. Every page tells the reader to consult a competent accountant when in doubt.

---

## Problem Statement

- **Users stop at the certificate step.** In production, the onboarding certificate step has no help for a user without an A1 certificate. The only way out is to leave. The branch `feat/certificate-help` adds a short note, but a person who does not know what a certificate is needs more.
- **Users do not know their own tax.** Many small companies give everything to an accountant. Some pay more tax than necessary because of a wrong rate: the wrong Anexo, a Fator R that nobody calculated, an old band, or ISS charged outside the DAS. They cannot check this today.
- **People arrive from many places.** They come from a referral, a consultant, an advertisement, problems with the platform, or the onboarding. There is no page that explains the basics to all of them.
- **MEI and non-optants hit a wall late.** Onboarding lets them in, and the issue then fails with `emitter_not_simples`. Nothing tells them that support is planned.

---

## Goals, Non-goals, Anti-goals

**Goals**

- The reader feels safe to issue their own invoices and to check that the rate is correct, and pays only the tax that is due.
- One path for each regime, plus shared chapters that every path links to.
- A rate calculator for the Simples Nacional.
- MEI and Lucro Presumido readers learn the rules too, and can sign up to know when NotaFlow supports them.
- The certificate chapter teaches how to buy one today and tells the reader that a purchase in NotaFlow comes soon. They can sign up for that too.
- The guide pages rank on search engines (static HTML, sitemap, structured data).

**Non-goals**

- Issuing for MEI or Lucro Presumido. The guide only announces it.
- Selling the certificate in NotaFlow. The partnership is not closed. The partner names (TecnoSpeed, Soluti) do not appear anywhere.
- A blog, a CMS, or a content pipeline.
- Personal tax advice, or a check of the reader's real invoices.

**Anti-goals** (a failure, even if the pages work)

- **Attacks on accountants.** The tone is delicate. The guide says "confira com seu contador", never "seu contador está errado". It builds independence: "você consegue entender e conferir isso".
- **A rule without a source.** A wrong rate in the name of Vapulab costs the reader money and costs us their trust.
- **"Você não precisa de contador" for an ME/EPP.** The guide separates what the reader can do alone (issue, check the rate, pay the DAS) from what usually needs an accountant (bookkeeping, payroll, pro-labore, annual declarations, a regime change).
- **A number that ages without a date.** Each value that changes (the MEI limit, the rate tables, the IBS/CBS calendar) shows the date of the last check.

---

## Solution

Eleven static HTML pages in the same pattern as the landing, a client-side calculator, and one public endpoint for a notify-me list.

```
/guia                               Hub: "Qual é o tipo da sua empresa?"
├── /guia/mei                       Path: MEI (+ notify-me)
├── /guia/simples-nacional          Path: Simples Nacional
│   ├── /guia/primeira-nota         The first invoice in NotaFlow, field by field
│   └── /guia/rotina-do-mes         Issue, check revenue, PGDAS-D, due dates
├── /guia/lucro-presumido           Path: Lucro Presumido (+ notify-me)
├── /guia/calculadora-simples       Rate calculator
├── /guia/certificado-digital       Shared: the A1 certificate (+ notify-me)
├── /guia/preciso-de-contador       Shared: alone vs. with an accountant
├── /guia/glossario                 Shared: terms in plain words
└── /guia/reforma-tributaria        Shared: IBS/CBS, what changes on the invoice
```

The hub has four choices: MEI, Simples Nacional (ME/EPP), Lucro Presumido, and "Não sei". "Não sei" asks for the CNPJ and tells the reader the regime with the same lookup that onboarding uses.

Entry points:

- The landing header and footer link to `/guia`.
- The onboarding certificate step ("Não tenho certificado A1", from `feat/certificate-help`) links to `/guia/certificado-digital`.
- The `emitter_not_simples` error text links to the path of the reader's regime.
- The certificate reminder e-mails link to `/guia/certificado-digital`.

---

## Design

### Pages

- Each page is a Vite input and a `STATIC_PAGES` entry (`apps/web/AGENTS.md` rule 10). The sitemap and robots.txt follow from `STATIC_PAGES`.
- Each page loads `src/site/site.ts` and `src/site/site.css`, like the landing. It has the same header and footer, the same theme toggle, and the Malphas tokens.
- Each page has its own title, description, canonical URL, og tags, and one JSON-LD block with `Article` and `BreadcrumbList`. The hub also has a `FAQPage` if it has a FAQ.
- Each page ends with three fixed parts, in this order:
  1. **Fontes:** the list of official sources for that page, with links.
  2. **Atualizado em:** the date of the last check of the content.
  3. **Aviso:** "Este guia explica as regras gerais e não substitui a orientação de um profissional. Em caso de dúvida, consulte um contador de sua confiança."
- Each path page ends with its next step. Simples: "Crie sua conta e emita sua primeira nota". MEI and Lucro Presumido: the notify-me form.
- `public/llms.txt` gets a short section that points to the guide.

### Hub

The mockup that was approved in the brainstorm: a title ("Emita suas notas com segurança"), the question "Qual é o tipo da sua empresa?", four cards in a 2x2 grid, and below them the shared chapters ("Para todos"). On a phone, the cards stack in one column.

### "Não sei": regime by CNPJ

- The reader types a CNPJ. The page calls a new public endpoint, `GET /api/public/cnpj-regime/:cnpj`. It reuses `apps/server/src/onboarding/cnpjLookup.ts`.
- The response holds only the regime: `mei`, `simples` or `other`. It does not return the company name, the address, or other data. The page then shows the matching path.
- The endpoint has a per-IP rate limit. It validates the CNPJ format and check digits before the lookup. It stores nothing.
- `other` says: "Sua empresa não é do Simples Nacional. Pode ser Lucro Presumido ou Lucro Real: confirme com seu contador." It then links to the Lucro Presumido path.

### Calculator

`/guia/calculadora-simples` runs fully in the browser and sends nothing to the server. It covers services only: Anexos III, IV and V. The page says that commerce and industry (Anexos I and II) are out of its scope.

The calculator follows the steps of the PGDAS-D, so that its result matches the DAS that the reader generates. The owner asked for the complete version. Each step shows its source.

**Step 1: the Anexo, by guided questions.** A wrong Anexo is the largest error. No official list links a CNAE to an Anexo: `apps/server/src/data/annexRule.ts` is NotaFlow's own reading of LC 123 art. 18, and issue #81 (a painter: Anexo III or IV) shows that the reading can be wrong. So the page asks plain questions, for example "Você cede mão de obra ao cliente?", "É obra ou serviço de construção?", "É atividade intelectual, como consultoria ou TI?". Each answer cites the paragraph of art. 18 that decides it (§5-B, §5-C, §5-D, §5-I and §5-M for the Fator R activities). The reader can also pick the Anexo directly. An intellectual service that no other paragraph names goes to Anexo V (art. 18 §5-I XII), not to Anexo III. Communication and cargo transport (§5-E) use the ICMS, so the page treats them as out of scope.

- An optional CNAE field preselects the answers with `annexRule`. The page labels it "sugestão: confirme com seu contador".
- When the answers do not decide the Anexo, the page says so and does not guess.

**Step 2: the Fator R, with the parts of the payroll.** Asked only when the activity uses the Fator R. The page asks for each part of the payroll of the last 12 months (salaries, pró-labore, FGTS, the employer contribution, and the other items that LC 123 art. 18 §24 and Res. CGSN 140 count), each one with a short explanation. The payroll counts what was paid in the 12 months before the month of the calculation, with the FGTS and the employer contribution actually paid. Rents and profit distribution do not count (art. 18 §24 and §26). The Fator R is the payroll divided by the RBT12 of both markets, truncated to two decimals as the PGDAS-D does: 0,2774 becomes 0,27 (PGDAS-D manual 8.2.1). At 0,28 or more the activity uses Anexo III, and below 0,28 it uses Anexo V. The page shows the Fator R, the 28% limit, and the Anexo that follows. Under 13 months of activity, the payroll follows the same rule as the RBT12 (Res. CGSN 140 art. 26 §4). Zero cases (art. 26 §6 and §7): with a payroll above zero and no revenue, r is 0,28; with no payroll, r is 0,01.

**Step 3: the RBT12, from the correct window.** The RBT12 is the sum of the 12 months before the month of the calculation, not including it. The reader types the revenue month by month, or pastes a list. A company under 13 months old uses the proportional rule (LC 123 art. 18 §1 and §2, Res. CGSN 140 art. 22 §2 and §3): the first month uses the revenue of the month × 12, and the next 11 months use the average of the previous months × 12. A month with no revenue counts in the average. An RBT12 of zero counts as R$ 1,00, which gives the nominal rate of band 1 (art. 21, sole paragraph). The domestic and the export revenue have each their own RBT12 for the rate (art. 23). The page shows which rule it used.

**Step 4: the revenue of the month, split by type.** The reader splits the revenue of the month into three lines: normal, with ISS retained by the customer, and service export. The page takes out of the DAS the share of each tax that does not apply to each line, as the PGDAS-D does: only the ISS share on the retained line (the federal shares stay), and the ISS, PIS and COFINS shares on the export line (IRPJ, CSLL and CPP stay). The ISS rate that the customer retains is not the rate of the current month. It is the ISS effective rate of the band of the month before the service, with the RBT12 of the 12 months before that month (Res. CGSN 140 art. 27 I). In the first month of activity it is 2%. When the invoice does not show the rate, the customer retains 5% (art. 27 V).

**Step 5: more than one activity (optional).** Behind a closed option, "Tenho mais de uma atividade". The reader adds one revenue line for each activity, and each line uses its own Anexo and the same RBT12, as in the segregation of the PGDAS-D. Most readers have one activity and never open it.

**The band 6 ISS.** The R$ 3,6 mi sublimit (LC 123 art. 13-A) is tested on the revenue of the current calendar year, not on the RBT12. With an RBT12 above R$ 3,6 mi and a year revenue under the sublimit, the calculator calculates the ISS: it applies the band 5 formula to the RBT12, caps the ISS at 5%, and spreads the excess to the federal taxes of the same band (Res. CGSN 140 art. 21 III b; PGDAS-D manual, Exemplo 8). The ISS stays in the DAS. When the year revenue passes the sublimit, the ISS stays in the DAS until the impediment starts: the next month if the excess is above 20%, and the next year if not (art. 20 §1 and §1-A; Res. CGSN 140 art. 24). The page calculates the case of an excess up to 20% as it does for the year, and warns when the excess is above 20%, because the rules of the two parts of the revenue differ. In both warnings it tells the reader to confirm with the accountant.

**Warnings, not calculations:** a year revenue more than 20% above the sublimit (see above), the 5% cap of the ISS share in band 5 (it acts only in Anexos III and IV: in Anexo V the ISS share never passes 5%), and the fixed ISS. The fixed ISS in LC 123 belongs to accounting offices (art. 18 §22-A) and to a small ME when the municipality allows it (art. 18 §18). The ISS of other professional societies is not fixed in the Simples (Res. CGSN 140 art. 25 §12). The page explains each case and tells the reader to confirm with the accountant. Above R$ 4,8 mi, the page says that the company leaves the Simples, and does not calculate.

**Output:** for each line, the Anexo with its reason, the band, the formula with the reader's numbers, the effective rate, and the value of each tax inside the DAS. Then the total DAS of the month.

**The comparison:** an optional field asks for the DAS value or the effective rate that the reader pays today. The page shows the difference in reais. The text is neutral: "A diferença pode ter um motivo, como uma atividade em outro Anexo. Leve este cálculo ao seu contador."

**The research decides the details.** The exact items of the Fator R payroll, the proportional rule, the share removal for each line, and the warning cases must come from the current text of LC 123 and Res. CGSN 140 (and the PGDAS-D manual). If a source disagrees with this section, the source wins and the RFC changes.

**Other rules:**
- **One source of truth:** the tables come from `packages/provider-nacional/src/rules/simplesRates.ts`, and the CNAE hint comes from `annexRule`. The calculator does not copy the numbers. `apps/web` does not depend on these modules today, so the implementer moves or exposes them. The calculator also depends on the fix PR (branch `fix/simples-band6-annex`, band 6 ISS and the `annexRule` gaps) and on adding the IRPJ, CSLL and CPP shares to the tables.
- The tables and the 2027 change: the tables in `simplesRates.ts` match LC 123 today. From 2027-01-01, Res. CGSN 190/2026 changes the tables for the CBS and the IBS. The new shares are not confirmed, so the page shows the date of its tables.
- The page explains the formula: `(RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12`.

### Notify-me list

One form, used on the MEI, Lucro Presumido, and certificate pages.

- **Fields:** e-mail, and the interests as checkboxes: "Emitir como MEI", "Emitir no Lucro Presumido", "Comprar o certificado pelo NotaFlow". The page checks the interest of the current page by default.
- **Consent:** one line under the button: "Usamos seu e-mail só para avisar sobre isso." It links to `/privacidade`. The privacy policy gets a paragraph about this list. This is not a material change: `LEGAL_VERSION` stays, and a new `POLICY_NOTICE` in `apps/server/src/legal.ts` tells users once in the app (the same as the terms update of #76).
- **Endpoint:** `POST /api/public/waitlist` with Turnstile, like the signup. It has a per-IP rate limit. A second signup with the same e-mail merges the interests and does not create a second row.
- **Admin:** a short list in `/admin` (e-mail, interests, source page, date) with a count by interest. The list is the input for a manual e-mail when a feature ships.
- **Unsubscribe:** an admin can remove a row with `softDelete`. A self-service unsubscribe link comes with the first e-mail, not now.

### Analytics

PostHog events: `guide_path` (`{path}` on a hub choice), `guide_cnpj_regime` (`{result}`), `guide_calculator` (`{action: 'calculated' | 'compared'}`, with no numbers), and `waitlist_signup` (`{interests, page}`). The campaign carry in `site.ts` keeps the source of readers from advertisements.

---

## Content

All the guide text is Brazilian Portuguese, in the voice of the landing: short sentences, concrete, no hype, and a soft tone. Each rule has its source (see [Sources and Accuracy](#sources-and-accuracy)).

### Shared chapters

**Certificado digital (`/guia/certificado-digital`)**

- What it is: the electronic identity of the company. NotaFlow signs each invoice with it.
- A1 vs. A3: A1 is a file with a password and a validity of 1 year (ITI). NotaFlow accepts the file as .pfx or .p12. A3 is a card, a token or a cloud key (HSM) with a validity of 1 to 5 years. NotaFlow uses only the A1, because a server can load a file. The page says this in one line.
- Why the reader needs it: the national NFS-e web emissor needs no certificate (user and password work for any company). NotaFlow sends each invoice through the API, and the API requires an XML signature with the certificate of the issuer. So the certificate is a need of NotaFlow, not of the national system. The page explains this difference.
- The future of the A1: Res. CG ICP-Brasil 211/2024 creates the "Selo Eletrônico" to replace the certificate of a legal entity (A1 or A3). The A1 stops working on 2029-03-03. Until 2029-03-02 the A1 works. The page does not promise that an A1 stays valid after that date. Whether the national API will accept the Selo Eletrônico is not confirmed.
- Who can buy it: the certificate is issued to the company, which needs a valid CNPJ, with a responsible person who is named in it. The exact rule that this person must be the legal representative is not confirmed, so the page says only that the certificate goes to the company and its responsible person. The Receita does not issue a certificate to a CNPJ that is inapta, suspensa or cancelada.
- How to buy it: choose an ICP-Brasil certificate authority from the official ITI list, pay, do the identity check (in person or by video call, as IN ITI 36/2026 allows), and download the file. It also covers what to do when the file and the password arrive.
- Care: keep the file and the password safe, never send them by e-mail, and renew before the certificate expires. The ITI says that nobody can sign with an expired certificate and that the renewal request must come within the validity. The ITI has no recovery procedure for a lost password: the reader asks the certificate authority.
- Price: no number. The ITI does not regulate the price, and the text says that it changes from one authority to another.
- "Em breve: compre seu certificado pelo NotaFlow", with the notify-me form.

**Preciso de contador? (`/guia/preciso-de-contador`)**

- What you can do alone: issue invoices, check the rate, generate and pay the DAS, keep the revenue under control.
- What usually needs an accountant: bookkeeping, payroll and pro-labore (eSocial and DCTFWeb), annual declarations (the DEFIS, by 31 March), a regime change, leaving the MEI, and a tax audit. The ECD does not apply to a company in the Simples, except one with angel-investor capital (IN RFB 2.003/2021 art. 3).
- The books: the tax rules of the Simples ask for the Livro Caixa (LC 123 art. 26 §2), and full bookkeeping replaces it. The Código Civil (art. 1.179) still asks every empresário and sociedade empresária for the Diário and a yearly balance sheet, and exempts only the "pequeno empresário". The page states both rules and does not choose between them.
- One table by regime: MEI, Simples, Lucro Presumido.
- The relationship: how to talk with your accountant about the rate. A list of questions to ask: "Qual é o meu Anexo e por quê?", "Você calcula o Fator R todo mês?", "O ISS está dentro do DAS?".

**Glossário (`/guia/glossario`)**

NFS-e, DPS, chave de acesso, DAS, PGDAS-D, RBT12, Anexo, faixa, alíquota nominal and alíquota efetiva, parcela a deduzir, Fator R, ISS (retained and inside the DAS), INSS retido, código de tributação nacional, NBS, competência, tomador, prestador, CNAE. One or two sentences each. Each term has an anchor so other pages can link to it.

**Reforma tributária (`/guia/reforma-tributaria`)**

- What IBS and CBS are, and the transition calendar: 2026 is a test year (CBS 0,9% and IBS 0,1%, LC 214/2025 arts. 343 and 346); from 2027 the CBS is in force and PIS and COFINS end; from 2029 to 2032 the ISS and the ICMS fall by 10% to 40% each year; in 2033 they end.
- What changes on the invoice, and what does not change for a company in the Simples. In 2026 the IBS and CBS rates do not apply to a company in the Simples (LC 214/2025 art. 348 III c). The obligation to issue the NFS-e with IBS and CBS starts for the Simples on 2027-01-01 (Ato Conjunto RFB/CGIBS 4/2026, art. 1 §1). The guide does not say that a Simples company must fill the IBS and CBS fields in 2026, and does not say that it pays them outside the DAS in 2026. For most other services the date is 2026-10-01.
- The Simples stays. From 2027 a company can opt to pay the IBS and the CBS by the regular regime, by semester, in September or March (LC 123 art. 13 §9 and §10, from LC 214/2025 art. 517). The Simples part for the ISS and ICMS in 2029 to 2032 is not confirmed, so the page does not state it.
- The dated values of the test period.

### Regime paths

**MEI (`/guia/mei`)**

- What the MEI is, the revenue limit, and the activities it allows. The limit in force is R$ 81 mil per year (LC 123 art. 18-A §1), with R$ 6.750 per month in the first year. LC 238/2026 (DOU 2026-10-21) raises it to R$ 110 mil for 2027 and R$ 140 mil from 2028, with up to 2 employees from 2027. The raise depends on the budget law (LC 238 art. 3), so the page shows the dates and does not promise it. The allowed activities are the list of Anexo XI of Res. CGSN 140. A software developer or a consultant is not on it, so that reader cannot be a MEI.
- The fixed DAS: there is no rate on the invoice. In 2026 it is R$ 81,05 of INSS, plus R$ 5,00 of ISS if the MEI provides services, plus R$ 1,00 of ICMS if it sells goods. The total of R$ 86,05 for a service MEI is derived from these parts. The DAS is due on day 20.
- How a MEI issues an NFS-e today: through the national issuer (web, app or API), with no certificate (Res. CGSN 140 art. 106-A). The invoice is mandatory for a customer with a CNPJ, and optional for a person.
- What happens when the company goes over the limit (desenquadramento): up to 20% over, it leaves on 1 January of the next year; above 20%, it leaves retroactively (LC 123 art. 18-A §7).
- "O NotaFlow ainda não emite para MEI. Estamos trabalhando nisso." with the notify-me form.

**Simples Nacional (`/guia/simples-nacional`)**

- How the Simples works: one DAS, Anexos, and bands.
- How to find your Anexo from the CNAE.
- The Fator R with a worked example, and why it can make the rate much lower.
- How to calculate the effective rate from the RBT12, with a link to the calculator.
- ISS: inside the DAS, or retained by the customer. In band 6 the ISS stays in the DAS while the revenue of the year is under the R$ 3,6 mi sublimit, and until the impediment starts above it (Res. CGSN 140 art. 21 III b and art. 24 I). After that, the company pays the ISS outside the DAS.
- INSS retained (11%) on a service with labor assignment. A company in the Simples suffers it only for the Anexo IV activities (IN RFB 2.110/2022 arts. 166 and 167, with Lei 8.212/1991 art. 31). Software and consulting are in Anexo III or V and have no retention.
- Service export: no ISS, PIS or COFINS inside the DAS. IRPJ, CSLL and CPP stay (LC 123 art. 18 §14).
- "Pontos para conferir com seu contador": the common errors, in a soft tone.
- Next step: `/guia/primeira-nota`.

**A primeira nota (`/guia/primeira-nota`)**

Each field of the NotaFlow invoice form, in the order of the screen (`NewInvoicePage.tsx`), with what it means and where the value comes from: Cliente, Serviço (the national code suggested from the CNAE), Competência, Descrição, Valor, Moeda and PTAX (abroad), Alíquota do Simples (from the band), ISS. Then "Mais opções": ISS retido, INSS retido (11%), Alíquota de ISS, Outro percentual do Simples, Código nacional, Código municipal, NBS, CST do PIS/COFINS, and the export fields. It also covers the configuração fiscal (Anexo, RBT12, ISS %, Regime IBS/CBS). The page uses screenshots of the real screens with synthetic data.

**Rotina do mês (`/guia/rotina-do-mes`)**

Issue the invoices, check the revenue of the month, update the RBT12, generate the DAS in the PGDAS-D, the due dates, and what to keep for the accountant.

**Lucro Presumido (`/guia/lucro-presumido`)**

- How the tax works: ISS, PIS (0,65%), COFINS (3%), IRPJ, and CSLL on a presumed profit, by quarter. For services in general the presumption is 32% for both IRPJ (15%, plus 10% above R$ 60 mil per quarter) and CSLL (9%). Since LC 224/2025, the presumption has +10% on the part of the revenue above R$ 5 mi per year (R$ 1,25 mi per quarter), for the IRPJ from 2026-01-01 and for the CSLL from 2026-04-01. A small company does not change. The 35,2% result is not confirmed by an official example, so the page does not publish it as a fact.
- Why an accountant is more necessary here.
- "Em breve no NotaFlow", with the notify-me form.

---

## Sources and Accuracy

**Each rule in the guide cites an official source.** A fact without an official source does not go in the guide. The [sources file](RFC_ACCOUNTING_GUIDE_SOURCES.md) holds the checked facts. A fact marked "not confirmed" there does not go in the guide as a fact.

The builder must research and check each fact against the current text of the source before writing it. The expected sources:

| Topic | Source |
| --- | --- |
| Simples Nacional, Anexos, bands, Fator R, MEI | LC 123/2006 (planalto.gov.br) and Resolução CGSN 140/2018 (normas.receita.fazenda.gov.br) |
| PGDAS-D, DAS, DEFIS | Portal do Simples Nacional (www8.receita.fazenda.gov.br/SimplesNacional) |
| MEI | LC 123 art. 18-A, LC 238/2026, and Res. CGSN 140 arts. 100 and 106-A and Anexo XI. The Portal do Empreendedor (gov.br/empresas-e-negocios) |
| NFS-e national, DPS, fields | Portal Nacional da NFS-e (gov.br/nfse), with the Manual and the technical notes |
| ISS, service list, rates of 2% to 5% | LC 116/2003 |
| INSS retained, 11% | Lei 8.212/1991, art. 31, and IN RFB 2.110/2022 arts. 108 to 115, 166 and 167 |
| IBS and CBS | EC 132/2023, LC 214/2025, and Ato Conjunto RFB/CGIBS 4/2026 (NFS-e dates) |
| Lucro Presumido | Leis 9.249/1995 and 9.430/1996, LC 224/2025, and IN RFB 2.305/2025 |
| Certificate, ICP-Brasil, authorities, Selo Eletrônico | ITI (gov.br/iti), IN ITI 36/2026, and Res. CG ICP-Brasil 211/2024 |

Rules:

- **Who checks it.** The owner reads the full text in the PR before the merge. The code review does not replace that read.
- **The code and the guide must agree.** If the research finds a difference between a source and `simplesRates.ts`, `format.ts`, or the issue rules, the builder stops and reports it. The builder does not change the code to match the guide in the same change.
- Each page shows its "Atualizado em" date. The RFC keeps a list of the values that change and the date of their last check, so that a later review knows what to check again.
- A link goes to the official page, not to a blog or to a certificate seller.

---

## Data Model

One new table. It follows [Data](../../../CONVENTIONS/DATA.md): `softDelete`, and every read uses `notDeleted`.

```
waitlist_signups
  id            text primary key
  email         text not null           -- lowercase
  interests     text not null           -- JSON array: 'mei' | 'lucro_presumido' | 'certificate'
  source_page   text not null           -- e.g. '/guia/mei'
  campaign      text                    -- the campaign carry, if any
  created_at    integer not null
  updated_at    integer not null
  deleted_at    integer
  unique (email) where deleted_at is null
```

The table has no `account_id`: the person has no account yet. It is a platform-level table, like the admin tables, and only the admin reads it.

---

## File Locations

| What | Where |
| --- | --- |
| Guide pages | `apps/web/guia/*.html` (Vite inputs) |
| Guide styles and scripts | `apps/web/src/site/guide/` (calculator, CNPJ check, notify-me form) |
| Public routes | `apps/server/src/web.ts` (`STATIC_PAGES`) |
| Endpoints | `apps/server/src/routes/` (`cnpjRegime.ts`, `waitlist.ts`) |
| Table and migration | `apps/server/src/db/schema.ts` and a new migration |
| Admin list | `apps/web/src/pages/admin/` |
| Onboarding link | `apps/web/src/pages/onboarding/steps.tsx` |

The guide does not wait for `feat/certificate-help`. That branch has no partner names today. The onboarding link goes in the branch that merges second.

---

## Testing

- **Pages:** `src/site/staticPages.test.ts` covers each new page: title, canonical, JSON-LD, the "Fontes", "Atualizado em" and "Aviso" parts, and an entry in the sitemap.
- **Calculator:** unit tests for the bands of each Anexo, the band limits, the Fator R at exactly 28%, the truncation to two decimals (0,2774 is 0,27), and the zero cases (payroll above zero with no revenue is 0,28; no payroll is 0,01), the band 6 ISS under the sublimit, the R$ 3,6 mi and R$ 4,8 mi limits, the RBT12 window, the proportional RBT12 in months 1, 2 and 11, the share removal for retained ISS and for export, the retained ISS rate from the RBT12 of the month before the service, and two activities in different Anexos. The expected values are the ones in `simplesRates.ts`, checked by hand against the LC 123 tables. At least three cases are worked examples from an official source (the PGDAS-D manual or a Receita answer), if the research finds them.
- **CNPJ regime:** a bad CNPJ, the three regimes, a lookup error, the rate limit, and a check that the response holds only the regime.
- **Waitlist:** Turnstile, the rate limit, the merge of a repeated e-mail, `softDelete`, and the admin-only list.
- **Text:** the anti-goals are part of the review. Each fact has a source. No text says that the reader does not need an accountant. No text blames the accountant.

---

## Builder Calls

These are decisions that the builder (Claude) made in the brainstorm. The owner can change them.

- The flat URL list under `/guia`, and the separate pages for the first invoice, the monthly routine, and the calculator.
- "Não sei" uses a new public endpoint that returns only the regime.
- The calculator runs in the browser and stores nothing.
- The calculator covers services only (Anexos III, IV, V), takes the Anexo from guided questions tied to LC 123 art. 18, and uses the CNAE only as a labeled hint. The owner asked for the complete version: Fator R by payroll parts, RBT12 window, revenue split by type, and multiple activities behind a closed option.
- The privacy paragraph is a `POLICY_NOTICE`, not a new `LEGAL_VERSION`, as in #76.
- The owner reads the full text in the PR. The guide does not wait for `feat/certificate-help`.
- One notify-me list with three interests, and a short admin list. The self-service unsubscribe waits for the first e-mail.
- No certificate price in the guide.
- The glossary and the tax reform chapters, which the owner did not ask for by name.
- The guide text in the voice of the landing.

Left to the implementer: how to share the header and footer between the HTML pages (copy them, or add a small build-time include), the screenshots, and the exact copy.
