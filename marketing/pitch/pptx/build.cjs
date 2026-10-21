// Builds the NotaFlow pitch as an editable .pptx from marketing/pitch/slides (1920x1080 source).
const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const pi = require("react-icons/pi");
const fs = require("fs");
const JSZip = require("jszip");

const OUT = process.argv[2] || path.join(path.dirname(module.filename), "..", "notaflow-pitch.pptx");

const SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
// pptxgenjs writes the theme fonts but always the Office palette, so the brand colors go in after.
async function applyTheme(file, theme) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const part = "ppt/theme/theme1.xml";
  const scheme = `<a:clrScheme name="${theme.name}">` + SLOTS.map((k) => `<a:${k}><a:srgbClr val="${theme.colors[k]}"/></a:${k}>`).join("") + "</a:clrScheme>";
  const xml = (await zip.file(part).async("string"))
    .replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, () => scheme)
    .replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, (_, head) => `${head}${theme.name}"`);
  zip.file(part, xml);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

const THEME = {
  name: "NotaFlow",
  headFontFace: "Arial",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "090D14", lt1: "FFFFFC", dk2: "121774", lt2: "EEF0F8",
    accent1: "1E40AF", accent2: "F5B83D", accent3: "3B4458", accent4: "C9CCF0",
    accent5: "2A31A0", accent6: "E2E4E8", hlink: "1E40AF", folHlink: "2A31A0",
  },
};
const HEX = { paper: "FAFAF9", track: "D5D9E6", muted: "5B6478", onDark: "F4F5FB", ring2: "343CB8", goldInk: "B7791F", dash: "B8BFD6" };

const p = (v) => v / 144; // source px -> inches (1920px = 13.333in)
const pt = (v) => v / 2; // source px -> points

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.title = "NotaFlow · Rodada de investimento";
pres.author = "Vapulab";
pres.company = "Vapulab";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;
const NAVY = C.text2, BLUE = C.accent1, GOLD = C.accent2, BODY = C.accent3, LAV = C.accent4, RING = C.accent5, BORDER = C.accent6;
const HEAD = "+mj-lt";

const kicker = (x, y, w, color) => ({
  name: "kicker", type: "body",
  x: p(x), y: p(y), w: p(w), h: p(40),
  fontSize: pt(24), bold: true, color, charSpacing: 2, margin: 0, valign: "top",
});
const footer = [
  { text: { text: "NotaFlow · Rodada de investimento", options: { x: p(128), y: p(992), w: p(1000), h: p(36), fontSize: pt(24), color: HEX.muted, margin: 0, isTextBox: true } } },
];
const slideNumber = { x: p(1592), y: p(992), w: p(200), h: p(36), fontSize: pt(24), color: HEX.muted, align: "right", margin: 0 };

const contentLayout = (title, background) => pres.defineSlideMaster({
  title,
  background: { color: background },
  objects: [
    ...footer,
    { placeholder: { options: kicker(128, 128, 1664, BLUE), text: "" } },
    { placeholder: { options: { name: "title", type: "title", align: "left", x: p(128), y: p(184), w: p(1600), h: p(170), fontSize: pt(72), bold: true, color: C.text1, margin: 0, valign: "top", lineSpacingMultiple: 0.95 }, text: "" } },
  ],
  slideNumber,
});
contentLayout("Conteúdo claro", HEX.paper);
contentLayout("Conteúdo lilás", C.background2);

pres.defineSlideMaster({
  title: "Capa",
  background: { color: NAVY },
  objects: [
    { placeholder: { options: { ...kicker(128, 300, 1300, GOLD), fontSize: pt(28) }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", align: "left", x: p(128), y: p(370), w: p(1450), h: p(290), fontSize: pt(128), bold: true, color: HEX.onDark, margin: 0, valign: "top", lineSpacingMultiple: 0.92 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "Frase",
  background: { color: NAVY },
  objects: [
    { placeholder: { options: { name: "title", type: "title", align: "left", x: p(128), y: p(380), w: p(1600), h: p(300), fontSize: pt(80), color: HEX.onDark, margin: 0, valign: "top", lineSpacingMultiple: 1.0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "Visão",
  background: { color: NAVY },
  objects: [
    { placeholder: { options: { ...kicker(128, 200, 1300, GOLD), fontSize: pt(28) }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", align: "left", x: p(128), y: p(270), w: p(1600), h: p(380), fontSize: pt(104), bold: true, color: HEX.onDark, margin: 0, valign: "top", lineSpacingMultiple: 0.95 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "Fechamento",
  background: { color: NAVY },
  objects: [
    { placeholder: { options: { name: "title", type: "title", align: "left", x: p(128), y: p(300), w: p(1300), h: p(180), fontSize: pt(160), bold: true, color: HEX.onDark, margin: 0, valign: "top" }, text: "" } },
  ],
});

// ---------- helpers ----------
let shapeSeq = 0;
const T = (slide, text, o) => slide.addText(text, {
  isTextBox: true, margin: o.margin ?? 0, valign: o.valign || "top", shape: o.fill ? pres.shapes.ROUNDED_RECTANGLE : undefined, rectRadius: o.fill ? p(16) : undefined,
  x: p(o.x), y: p(o.y), w: p(o.w), h: p(o.h),
  fontSize: pt(o.size || 28), bold: !!o.bold, color: o.color || BODY,
  fontFace: o.head ? HEAD : undefined, align: o.align || "left",
  lineSpacingMultiple: o.line || (o.head ? 1.0 : 1.12),
  charSpacing: o.charSpacing, objectName: o.name || `text-${++shapeSeq}`,
  paraSpaceAfter: o.paraSpaceAfter, fill: o.fill ? { color: o.fill } : undefined,
});
const card = (slide, x, y, w, h, o = {}) => slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: p(x), y: p(y), w: p(w), h: p(h), rectRadius: p(16),
  fill: { color: o.fill || C.background1 },
  line: o.line ? { color: o.line, width: o.lineW || 0.75, dashType: o.dash } : { type: "none" },
  shadow: o.shadow ? { type: "outer", color: "1E40AF", opacity: 0.3, blur: 14, offset: 6, angle: 90 } : undefined,
  objectName: o.name || `card-${++shapeSeq}`,
});
const ring = (slide, x, y, d, color) => slide.addShape(pres.shapes.OVAL, {
  x: p(x), y: p(y), w: p(d), h: p(d), fill: { type: "none" }, line: { color, width: 1 }, objectName: `ring-${++shapeSeq}`,
});
const dot = (slide, x, y, d, color, name) => slide.addShape(pres.shapes.OVAL, {
  x: p(x), y: p(y), w: p(d), h: p(d), fill: { color }, line: { type: "none" }, objectName: name || `dot-${++shapeSeq}`,
});
const pill = (slide, text, x, y, o) => {
  const w = text.length * o.size * 0.56 + o.padX * 2;
  slide.addText(text, {
    isTextBox: true, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: p(o.h / 2),
    x: p(x), y: p(y), w: p(w), h: p(o.h), margin: 0, align: "center", valign: "middle",
    fontSize: pt(o.size), bold: true, color: o.color, fill: { color: o.fill },
    line: o.line ? { color: o.line, width: 0.75 } : { type: "none" }, objectName: `pill-${++shapeSeq}`,
  });
  return w;
};
const pills = (slide, items, x0, y0, maxW, o) => {
  let x = x0, y = y0;
  for (const it of items) {
    const w = it.length * o.size * 0.56 + o.padX * 2;
    if (x + w > x0 + maxW) { x = x0; y += o.h + o.gap; }
    x += pill(slide, it, x, y, o) + o.gap;
  }
  return y + o.h;
};
const iconCache = {};
const icon = async (slide, name, hex, x, y, size) => {
  const key = name + hex;
  if (!iconCache[key]) {
    const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(pi[name], { color: "#" + hex, size: "256" }));
    iconCache[key] = "image/png;base64," + (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");
  }
  slide.addImage({ data: iconCache[key], x: p(x), y: p(y), w: p(size), h: p(size), altText: name.replace(/^Pi|Bold$/g, ""), objectName: `icon-${name}` });
};
const head = (slide, kick, title) => {
  slide.addText(kick.toUpperCase(), { placeholder: "kicker" });
  slide.addText(title, { placeholder: "title", fontFace: HEAD });
};
const S = (masterName, sectionTitle) => pres.addSlide({ masterName, sectionTitle });

(async () => {
  // 1 · cover
  pres.addSection({ title: "Abertura" });
  let s = S("Capa", "Abertura");
  ring(s, 1240, -160, 900, RING); ring(s, 1420, 20, 540, HEX.ring2); dot(s, 1560, 160, 120, GOLD, "gold-dot");
  s.addText("NOTAFLOW · RODADA DE INVESTIMENTO", { placeholder: "kicker" });
  s.addText("Descomplicar o que parece complicado.", { placeholder: "title", fontFace: HEAD });
  T(s, "A nota fiscal de serviço do pequeno negócio, do cliente à chave de acesso, em um clique.", { x: 128, y: 700, w: 1200, h: 130, size: 40, color: LAV, line: 1.15 });
  T(s, "notaflow.vapulab.com · um produto Vapulab", { x: 128, y: 980, w: 1000, h: 36, size: 24, color: LAV });
  s.addNotes("Abra com a promessa. Toda empresa de serviço no Brasil precisa emitir nota, e quase todas acham isso difícil. O NotaFlow existe para tornar isso simples. Essa frase é o fio de toda a apresentação.");

  // 2 · dor
  pres.addSection({ title: "O problema" });
  s = S("Conteúdo claro", "O problema");
  head(s, "O problema", "Emitir nota de serviço no Brasil parece simples. Não é.");
  const pains = [
    ["Sem “copiar nota”", "O portal nacional obriga a digitar a nota inteira de novo, todo mês, mesmo quando ela é igual à anterior."],
    ["Alíquota que muda", "No Simples, a taxa sai da receita dos últimos 12 meses, do anexo certo e do fator R. Um erro faz pagar imposto a mais."],
    ["Tecnologia hostil", "A integração exige certificado digital, mTLS e assinatura XML. Fora do alcance de quem não é programador."],
    ["Regras em movimento", "A reforma tributária (IBS e CBS) muda o layout da nota em dezembro de 2026 e de novo em janeiro de 2027."],
  ];
  pains.forEach(([h, b], i) => {
    const x = 128 + (i % 2) * 848, y = 400 + Math.floor(i / 2) * 272;
    card(s, x, y, 816, 248, { line: BORDER });
    T(s, h, { x: x + 40, y: y + 36, w: 736, h: 56, size: 40, bold: true, head: true, color: NAVY });
    T(s, b, { x: x + 40, y: y + 100, w: 736, h: 130, size: 28 });
  });
  s.addNotes("Quatro dores reais. O portal não copia nota. A alíquota do Simples depende de cálculo que pouca gente domina. A tecnologia da API é inacessível para um pequeno negócio. E a reforma tributária muda tudo de novo agora. Resultado: tempo perdido todo mês e risco de pagar imposto errado.");

  // 3 · mes
  s = S("Frase", "O problema");
  T(s, "“", { x: 120, y: 150, w: 200, h: 220, size: 220, bold: true, head: true, color: GOLD });
  s.addText("Todo mês a mesma coisa: abrir o emissor e digitar de novo uma nota quase igual à do mês passado.", { placeholder: "title", fontFace: HEAD });
  T(s, "O NotaFlow resolve isso.", { x: 128, y: 760, w: 1200, h: 70, size: 48, bold: true, head: true, color: GOLD });
  s.addNotes("Deixe a frase respirar. Todo mundo na sala que já teve empresa de serviço conhece essa rotina. É aqui que o investidor sente a dor.");

  // 4 · solucao
  pres.addSection({ title: "A solução" });
  s = S("Conteúdo claro", "A solução");
  head(s, "A solução", "Do cliente à chave de acesso, sem sair do NotaFlow.");
  const feats = [
    ["PiPaperPlaneTiltBold", "Emitir", "Assinada com o certificado A1 da empresa. A chave de acesso volta na hora.", false],
    ["PiLightningBold", "Emitir parecida", "Copia a nota do mês passado com todos os grupos fiscais. Muda o valor, e pronto.", true],
    ["PiDatabaseBold", "Histórico sozinho", "As notas já emitidas, até fora do NotaFlow, chegam do sistema nacional a cada 30 minutos.", false],
    ["PiCheckBold", "Cancelar", "Com motivo e registro de quem cancelou e quando. Sem abrir outro sistema.", false],
  ];
  for (const [i, [ic, h, b, star]] of feats.entries()) {
    const x = 128 + i * 424;
    card(s, x, 400, 392, 500, star ? { fill: C.text2 } : { line: BORDER });
    dot(s, x + 40, 440, 96, star ? GOLD : C.background2, `icon-bg-${i}`);
    await icon(s, ic, star ? "121774" : "1E40AF", x + 64, 464, 48);
    T(s, h, { x: x + 40, y: 568, w: 312, h: 110, size: 40, bold: true, head: true, color: star ? HEX.onDark : NAVY });
    T(s, b, { x: x + 40, y: 690, w: 312, h: 190, size: 28, color: star ? LAV : BODY });
  }
  s.addNotes("O NotaFlow emite, copia e cancela NFS-e pelo sistema nacional. O destaque é o Emitir parecida: a função que o portal do governo não tem e que resolve a rotina do mês. O histórico chega sozinho, então o cliente não começa do zero.");

  // 5 · escondido
  s = S("Conteúdo lilás", "A solução");
  head(s, "Nossa tese", "A complexidade fica com a gente. O cliente vê um botão.");
  const terms = ["Receita dos últimos 12 meses", "Fator R", "Anexos I a V", "INSS retido", "Dólar pela PTAX", "IBS e CBS", "Código de serviço pelo CNAE", "mTLS", "Assinatura XML"];
  pills(s, terms, 128, 440, 900, { size: 28, padX: 28, h: 64, gap: 16, color: BODY, fill: C.background1, line: HEX.track });
  s.addShape(pres.shapes.RIGHT_ARROW, { x: p(1070), y: p(560), w: p(160), h: p(80), fill: { color: GOLD }, line: { type: "none" }, objectName: "arrow" });
  s.addText("Emitir nota", {
    isTextBox: true, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: p(60), x: p(1290), y: p(540), w: p(440), h: p(120),
    margin: 0, align: "center", valign: "middle", fontSize: pt(56), bold: true, fontFace: HEAD, color: HEX.onDark,
    fill: { color: BLUE }, line: { type: "none" }, objectName: "emitir-button",
    shadow: { type: "outer", color: "1E40AF", opacity: 0.35, blur: 20, offset: 8, angle: 90 },
  });
  T(s, "Um clique. A nota sai certa.", { x: 1290, y: 690, w: 440, h: 40, size: 28, align: "center" });
  s.addNotes("Essa é a tese da empresa. Cada termo da esquerda é algo que o NotaFlow já calcula sozinho: a faixa do Simples pela receita, o fator R, o anexo sugerido pelo CNAE, o INSS retido, o câmbio pela PTAX do Banco Central, o novo grupo IBS e CBS, e a parte técnica de certificado e assinatura. O cliente não precisa saber nada disso. Ele só aperta um botão.");

  // 6 · agora
  pres.addSection({ title: "Por que agora" });
  s = S("Conteúdo claro", "Por que agora");
  head(s, "Por que agora", "A reforma tributária obriga toda empresa do Simples a mudar como emite nota.");
  const dates = [
    ["20 out 2026", "Novo layout da nota (NT 009) entra em teste no sistema nacional.", false],
    ["30 out 2026", "Prazo para o Simples escolher o regime de IBS e CBS de 2027.", false],
    ["1 dez 2026", "Layout novo em produção. Nota fora do padrão é recusada.", true],
    ["1 jan 2027", "IBS e CBS passam a ser obrigatórios na nota do Simples.", true],
  ];
  s.addShape(pres.shapes.LINE, { x: p(128), y: p(412), w: p(1664), h: 0, line: { color: HEX.track, width: 2 }, objectName: "timeline" });
  dates.forEach(([d, t, hot], i) => {
    const x = 128 + i * 424;
    dot(s, x, 400, 24, hot ? GOLD : BLUE, `milestone-${i}`);
    T(s, d, { x, y: 448, w: 392, h: 60, size: 44, bold: true, head: true, color: NAVY });
    T(s, t, { x, y: 516, w: 380, h: 130, size: 28 });
  });
  T(s, "O NotaFlow já emite no layout novo. Quem emite à mão vai precisar de ajuda, e vai procurar agora.", {
    x: 128, y: 700, w: 1664, h: 180, size: 36, bold: true, color: NAVY, fill: "EEF0F8", line: 1.1, margin: 20, valign: "middle",
  });
  s.addNotes("A janela é agora. A reforma tributária cria uma onda de mudança obrigatória em poucos meses. Cada empresa que emite nota pelo portal vai ter que aprender regras novas. Nós já entregamos o layout novo. É o melhor momento para capturar quem vai procurar uma ferramenta.");

  // 7 · tracao
  s = S("Conteúdo claro", "Por que agora");
  head(s, "O que já temos", "No ar, com cadastro aberto e notas reais emitidas.");
  const stats = [["No ar", "Cadastro aberto desde 11 out 2026"], ["377", "entregas de código em 2 semanas"], ["I a V", "anexos do Simples calculados sozinhos"], ["[__]", "empresas emitindo hoje"]];
  stats.forEach(([n, l], i) => {
    const x = 128 + i * 424, last = i === 3;
    card(s, x, 400, 392, 290, last ? { fill: C.text2 } : { line: BORDER });
    T(s, n, { x: x + 40, y: 436, w: 312, h: 110, size: 96, bold: true, head: true, color: last ? GOLD : BLUE });
    T(s, l, { x: x + 40, y: 556, w: 312, h: 110, size: 28, color: last ? LAV : BODY });
  });
  pills(s, ["Emitir", "Emitir parecida", "Cancelar", "Importar histórico", "Exportação com PTAX", "Layout NT 009", "Várias empresas por conta", "Cadastro guiado pelo CNPJ", "Login com passkey e Google"],
    128, 730, 1664, { size: 24, padX: 24, h: 52, gap: 12, color: NAVY, fill: C.background2 });
  s.addNotes("Não é uma ideia, é um produto em produção em notaflow.vapulab.com. O cadastro está aberto ao público desde 11 de outubro. A velocidade de entrega mostra a capacidade de execução: o produto saiu do zero para produção em semanas. Preencha o número de empresas ativas antes de apresentar.");

  // 8 · confianca
  s = S("Conteúdo lilás", "Por que agora");
  head(s, "Confiança", "Nota fiscal não aceita erro. Construímos para não errar.");
  const trust = [
    ["PiLockBold", "Certificado protegido", "Criptografia AES-256-GCM, com a chave fora do banco de dados."],
    ["PiCheckCircleBold", "Nunca emite duas vezes", "Cada falha de rede é conferida no sistema nacional antes de tentar de novo."],
    ["PiPulseBold", "Vigiado o tempo todo", "Métricas, alertas e verificação externa avisam o time antes do cliente."],
    ["PiGlobeBold", "Dados no Brasil", "Servidor no Brasil, backup externo, trilha de auditoria e teste de invasão feito."],
  ];
  for (const [i, [ic, h, b]] of trust.entries()) {
    const x = 128 + (i % 2) * 848, y = 400 + Math.floor(i / 2) * 272;
    card(s, x, y, 816, 248);
    await icon(s, ic, "1E40AF", x + 40, y + 40, 64);
    T(s, h, { x: x + 136, y: y + 36, w: 640, h: 56, size: 40, bold: true, head: true, color: NAVY });
    T(s, b, { x: x + 136, y: y + 100, w: 640, h: 130, size: 28 });
  }
  s.addNotes("Descomplicar não é ser descuidado. O certificado digital é o bem mais sensível do cliente, e ele fica cifrado. O sistema reserva o número da nota antes de emitir, então uma queda de rede nunca gera nota duplicada. Há monitoramento e alertas, e o produto passou por um teste de invasão antes de abrir o cadastro.");

  // 9 · modelo
  pres.addSection({ title: "Modelo e rota" });
  s = S("Conteúdo claro", "Modelo e rota");
  head(s, "Modelo de negócio", "Grátis para entrar. Receita onde está a complexidade.");
  const steps = [
    ["1 · AQUISIÇÃO", "Emissão grátis e sem limite", "Sem cartão e sem limite de notas. Um guia contábil com calculadora do Simples traz tráfego orgânico.", false],
    ["2 · RECEITA", "Planos pagos", "Recursos avançados por assinatura: [definir, ex.: envio automático, várias empresas, acesso do contador].", false],
    ["3 · EXPANSÃO", "Certificado no app", "O certificado A1 vendido dentro do NotaFlow, com uma certificadora parceira (em negociação).", true],
  ];
  steps.forEach(([k, h, b, dark], i) => {
    const x = 128 + i * 576;
    card(s, x, 400, 480, 500, dark ? { fill: C.text2 } : { line: BORDER });
    T(s, k, { x: x + 40, y: 440, w: 400, h: 36, size: 24, bold: true, color: dark ? GOLD : BLUE, charSpacing: 1.5 });
    T(s, h, { x: x + 40, y: 492, w: 400, h: 110, size: 40, bold: true, head: true, color: dark ? HEX.onDark : NAVY });
    T(s, b, { x: x + 40, y: 616, w: 400, h: 260, size: 28, color: dark ? LAV : BODY });
    if (i < 2) s.addShape(pres.shapes.RIGHT_ARROW, { x: p(x + 496), y: p(634), w: p(64), h: p(32), fill: { color: GOLD }, line: { type: "none" }, objectName: `arrow-${i}` });
  });
  s.addNotes("Hoje o NotaFlow é grátis, de propósito: tirar a barreira de entrada e ganhar base. A receita vem em camadas. Planos pagos para quem precisa de mais. E o certificado digital, que é a etapa onde hoje mais gente desiste: vender dentro do app resolve a dor e gera receita por cliente novo. A parceria com a certificadora está em negociação; não cite o nome em público.");

  // 10 · rota
  s = S("Conteúdo claro", "Modelo e rota");
  head(s, "Onde queremos chegar", "Da nota de serviço do Simples a toda nota do pequeno negócio.");
  const road = [
    ["AGORA · FIM DE 2026", ["IBS e CBS completos em toda nota", "Guia contábil e calculadora do Simples", "Certificado A1 dentro do app"], true],
    ["2027", ["MEI e Lucro Presumido", "Nota enviada por e-mail, com PDF", "Planos pagos"], false],
    ["DEPOIS", ["Prefeituras fora do sistema nacional", "NF-e de produto", "Uma conta para toda a vida fiscal da empresa"], false],
  ];
  road.forEach(([k, items, dark], i) => {
    const x = 128 + i * 565;
    card(s, x, 400, 533, 460, dark ? { fill: C.text2 } : { line: BORDER });
    T(s, k, { x: x + 40, y: 440, w: 453, h: 36, size: 24, bold: true, color: dark ? GOLD : BLUE, charSpacing: 1.5 });
    s.addText(items.map((t, j) => ({ text: t, options: { bullet: { indent: 18 }, breakLine: j < items.length - 1 } })), {
      isTextBox: true, x: p(x + 40), y: p(500), w: p(453), h: p(330), margin: 0, valign: "top",
      fontSize: pt(28), color: dark ? HEX.onDark : BODY, paraSpaceAfter: 10, objectName: `road-list-${i}`,
    });
  });
  s.addNotes("A rota é clara. Agora: fechar a reforma tributária, trazer tráfego com o guia contábil e tirar a barreira do certificado. Em 2027: abrir para MEI e Lucro Presumido, que multiplicam o mercado, e começar a cobrar. Depois: cobrir as prefeituras fora do sistema nacional e a nota de produto. O destino é ser o lugar onde o pequeno negócio resolve toda a parte fiscal.");

  // 11 · visao
  pres.addSection({ title: "Visão, time e rodada" });
  s = S("Visão", "Visão, time e rodada");
  ring(s, -240, 560, 760, RING);
  s.addText("NOSSA VISÃO", { placeholder: "kicker" });
  s.addText("Nosso objetivo é um só: descomplicar o que parece complicado.", { placeholder: "title", fontFace: HEAD });
  s.addText([
    { text: "Quando o dono de uma pequena empresa pensar em nota fiscal, a resposta vai ser uma só: ", options: { color: LAV } },
    { text: "é só abrir o NotaFlow.", options: { color: GOLD, bold: true } },
  ], { isTextBox: true, x: p(128), y: p(700), w: p(1300), h: p(140), margin: 0, valign: "top", fontSize: pt(40), lineSpacingMultiple: 1.15, objectName: "vision-sub" });
  s.addNotes("Este é o momento de emoção. O imposto brasileiro é famoso por ser complicado, e isso não vai mudar. O que pode mudar é quem carrega essa complicação. Nós carregamos, para que o empreendedor cuide do negócio dele.");

  // 12 · time
  s = S("Conteúdo claro", "Visão, time e rodada");
  head(s, "Quem constrói", "Um time pequeno que entrega como um grande.");
  card(s, 128, 400, 984, 420, { line: BORDER });
  s.addText("LS", { isTextBox: true, shape: pres.shapes.OVAL, x: p(176), y: p(448), w: p(160), h: p(160), align: "center", valign: "middle", margin: 0, fontSize: pt(64), bold: true, fontFace: HEAD, color: GOLD, fill: { color: NAVY }, line: { type: "none" }, objectName: "avatar-ls" });
  T(s, "Lincoln Santos", { x: 376, y: 448, w: 700, h: 60, size: 44, bold: true, head: true, color: NAVY });
  T(s, "Fundador e engenheiro · Vapulab", { x: 376, y: 516, w: 700, h: 40, size: 28, bold: true, color: BLUE });
  T(s, "Construiu o NotaFlow de ponta a ponta: produto, integração com o sistema nacional, segurança e operação. [Adicionar experiência anterior.]", { x: 376, y: 572, w: 696, h: 220, size: 28 });
  card(s, 1144, 400, 648, 420, { fill: C.background2, line: HEX.dash, lineW: 1.5, dash: "dash" });
  T(s, "[Nome]", { x: 1192, y: 448, w: 552, h: 60, size: 44, bold: true, head: true, color: NAVY });
  T(s, "[Papel]", { x: 1192, y: 516, w: 552, h: 40, size: 28, bold: true, color: BLUE });
  T(s, "[Sócio, conselheiro ou próxima contratação com o investimento.]", { x: 1192, y: 572, w: 552, h: 200, size: 28 });
  s.addNotes("Mostre a capacidade de execução: um produto fiscal complexo, em produção, com segurança e monitoramento, feito por um time enxuto em poucas semanas. Diga quem mais está no time ou quem entra com o investimento.");

  // 13 · pedido
  s = S("Conteúdo lilás", "Visão, time e rodada");
  head(s, "A rodada", "Investimento para transformar produto pronto em escala.");
  card(s, 128, 400, 620, 440, { fill: C.text2 });
  T(s, "CAPTAÇÃO", { x: 176, y: 448, w: 524, h: 36, size: 24, bold: true, color: GOLD, charSpacing: 1.5 });
  T(s, "[R$ __]", { x: 176, y: 500, w: 524, h: 130, size: 120, bold: true, head: true, color: HEX.onDark });
  T(s, "Meta em [18] meses: [__] empresas emitindo e [R$ __] de receita recorrente por mês.", { x: 176, y: 650, w: 524, h: 150, size: 28, color: LAV });
  const uses = [["Produto", "MEI, Lucro Presumido, prefeituras e NF-e", 450, BLUE], ["Aquisição", "Guia contábil, conteúdo e parceria com contadores", 330, BLUE], ["Time", "Suporte, comercial e engenharia", 220, GOLD]];
  uses.forEach(([l, c, fillW, col], i) => {
    const x = 812, w = 980, y = 410 + i * 150;
    T(s, l, { x, y, w: 600, h: 44, size: 32, bold: true, color: NAVY });
    T(s, "[__%]", { x: x + w - 200, y, w: 200, h: 44, size: 32, bold: true, color: BLUE, align: "right" });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: p(x), y: p(y + 56), w: p(w), h: p(20), rectRadius: p(10), fill: { color: HEX.track }, line: { type: "none" }, objectName: `bar-track-${i}` });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: p(x), y: p(y + 56), w: p(fillW * w / 1036), h: p(20), rectRadius: p(10), fill: { color: col }, line: { type: "none" }, objectName: `bar-fill-${i}` });
    T(s, c, { x, y: y + 90, w, h: 36, size: 24 });
  });
  s.addNotes("O produto existe e funciona. O investimento acelera três coisas: ampliar o público com MEI e Lucro Presumido, levar o NotaFlow a quem precisa antes da virada da reforma, e montar o time de suporte e vendas. Preencha o valor, a divisão e a meta antes de apresentar; as barras são ilustrativas até lá.");

  // 14 · fim
  s = S("Fechamento", "Visão, time e rodada");
  ring(s, 1240, -160, 900, RING); ring(s, 1420, 20, 540, HEX.ring2); dot(s, 1560, 160, 120, GOLD, "gold-dot");
  s.addText("NotaFlow", { placeholder: "title", fontFace: HEAD });
  T(s, "Vamos descomplicar juntos.", { x: 128, y: 500, w: 1200, h: 80, size: 56, bold: true, head: true, color: GOLD });
  T(s, "comercial@vapulab.com\nnotaflow.vapulab.com", { x: 128, y: 630, w: 1000, h: 110, size: 32, color: LAV, line: 1.3 });
  T(s, "Um produto Vapulab · Londrina, PR", { x: 128, y: 980, w: 1000, h: 36, size: 24, color: LAV });
  s.addNotes("Feche com o convite. Abra o NotaFlow no celular e mostre o Emitir parecida ao vivo, se houver tempo: a demonstração vale mais que qualquer slide.");

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", path.resolve(OUT));
})().catch((e) => { console.error(e); process.exit(1); });
