// Envio do boleto emitido ao cliente: e-mail (Microsoft 365, caixa do
// Financeiro) e WhatsApp (SP Connect, chamado pela tela com a sessão do
// usuário). Contatos vêm da Regra de faturamento, o mesmo cadastro do endereço
// usado na emissão. Cada boleto vai uma vez por canal; reenviar exige motivo.
const { createHash, randomUUID } = require("node:crypto");
const { createProvider, configuration } = require("./communication-provider");
const { SENDER } = require("./communication-rule");
const { recipients } = require("./communication-recipients");
const { escapeHtml, layoutEmail, logoInline } = require("./email-layout");

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digits = (value) => String(value || "").replace(/\D/g, "");
const CHANNELS = ["email", "whatsapp"];
const LEASE_MS = 5 * 60 * 1000;
class DeliveryError extends Error {
  constructor(message, status = 409, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function emailsFrom(value) {
  const list = String(value || "").split(/[;,\s]+/).filter(Boolean);
  if (!list.length) return [];
  try { return recipients(list); } catch { return null; }
}
// WhatsApp do Brasil no formato internacional: 55 + DDD + número.
function whatsappFrom(value) {
  let d = digits(value);
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return /^55[1-9]{2}\d{8,9}$/.test(d) ? d : "";
}
// Mesmo identificador de customer-directory.js billingKey e de billingAddresses.
const profileKeys = (row) =>
  [
    digits(row.cpfCnpj) && `doc-${digits(row.cpfCnpj)}`,
    digits(row.clientNumber) && `client-${digits(row.clientNumber)}`,
  ].filter(Boolean);
async function contactsFor(db, row) {
  for (const key of profileKeys(row)) {
    const found = await db.collection("billingProfiles").where("identityKey", "==", key).limit(2).get();
    if (!found.docs.length) continue;
    if (found.docs.length > 1)
      throw new DeliveryError("Há mais de uma Regra de faturamento para este cliente. Corrija o cadastro antes de enviar.");
    const doc = found.docs[0], p = doc.data();
    const channels = (Array.isArray(p.deliveryChannels) ? p.deliveryChannels : []).filter((c) => CHANNELS.includes(c));
    const email = emailsFrom(p.billingEmail);
    return {
      profileId: doc.id,
      channels,
      email: email || [],
      emailInvalid: email === null,
      whatsapp: whatsappFrom(p.whatsapp),
      whatsappInvalid: Boolean(digits(p.whatsapp)) && !whatsappFrom(p.whatsapp),
    };
  }
  return null;
}
function contactError(contacts, channel) {
  const label = channel === "email" ? "e-mail" : "WhatsApp";
  if (!contacts) return "Cliente sem Regra de faturamento. Cadastre o meio de envio e o contato antes de enviar.";
  if (!contacts.channels.includes(channel)) return `A Regra de faturamento deste cliente não tem ${label} como meio de envio.`;
  if (channel === "email" && (contacts.emailInvalid || !contacts.email.length)) return "Confira o e-mail de faturamento na Regra de faturamento.";
  if (channel === "whatsapp" && !contacts.whatsapp) return "Confira o WhatsApp (com DDD) na Regra de faturamento.";
  return "";
}
function emailEnabled(env) {
  return env.FINANCEIRO_COMMUNICATION_SEND_ENABLED === "true" && configuration(env).configured;
}
// Situação pública: "sending" vencido conta como incerto (pode ter saído).
function publicDelivery(d, now = Date.now()) {
  if (!d) return { state: "none" };
  const state = d.state === "sending" && Date.parse(d.leaseUntil) <= now ? "unknown" : d.state;
  return { state, to: d.to || "", at: d.updatedAt || "", error: d.error || "", resends: d.resends || 0 };
}
const deliveryKey = (environment, transactionId, token, channel) => hash([environment, transactionId, token, channel]);
function deliveryRef(db, environment, transactionId, token, channel) {
  return db.collection("boletoDeliveries").doc(deliveryKey(environment, transactionId, token, channel));
}
// Reserva o envio. Um boleto vai uma vez por canal; enviado ou incerto só sai
// de novo com motivo. Falha comprovada (nada saiu) pode tentar outra vez.
async function claim(db, ref, { uid, channel, to, base, resendReason, allowed }) {
  const reason = typeof resendReason === "string" ? resendReason.trim() : "";
  if (resendReason !== undefined && (reason.length < 10 || reason.length > 500))
    throw new DeliveryError("Informe o motivo do reenvio (10 a 500 caracteres).", 400);
  return db.runTransaction(async (tx) => {
    if (allowed) await allowed(tx);
    const now = new Date(), at = now.toISOString();
    const old = (await tx.get(ref)).data();
    const current = publicDelivery(old, now.getTime());
    if (current.state === "sending") throw new DeliveryError("Envio em andamento. Aguarde alguns minutos.");
    if (["sent", "unknown"].includes(current.state) && !reason)
      throw new DeliveryError(
        current.state === "sent"
          ? `Boleto já enviado por ${channel === "email" ? "e-mail" : "WhatsApp"} em ${at.slice(0, 10) === current.at.slice(0, 10) ? "hoje" : current.at.slice(0, 10).split("-").reverse().join("/")}. Para reenviar, informe o motivo.`
          : "O último envio ficou sem confirmação e pode ter chegado ao cliente. Para enviar de novo, informe o motivo.",
        409,
        { alreadySent: true },
      );
    const attemptId = randomUUID();
    const resend = ["sent", "unknown"].includes(current.state);
    tx.set(ref, {
      ...base,
      channel,
      to,
      state: "sending",
      attemptId,
      leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
      uid,
      createdAt: old?.createdAt || at,
      updatedAt: at,
      error: "",
      resends: (old?.resends || 0) + (resend ? 1 : 0),
    });
    tx.create(ref.collection("events").doc(), { action: resend ? "resend" : "send", channel, to, uid, at, attemptId, ...(reason ? { reason } : {}) });
    return attemptId;
  });
}
async function finish(db, ref, { uid, attemptId, state, error = "", providerId = "" }) {
  return db.runTransaction(async (tx) => {
    const old = (await tx.get(ref)).data();
    if (!old || old.attemptId !== attemptId || old.state !== "sending")
      throw new DeliveryError("Tentativa de envio não encontrada ou já concluída.");
    const at = new Date().toISOString();
    const next = { ...old, state, error: String(error || "").slice(0, 300), providerId: String(providerId || "").slice(0, 200), updatedAt: at };
    delete next.leaseUntil;
    tx.set(ref, next);
    tx.create(ref.collection("events").doc(), { action: "result", channel: old.channel, state, uid, at, attemptId, ...(error ? { error: next.error } : {}), ...(providerId ? { providerId: next.providerId } : {}) });
    return next;
  });
}
// Links "Adicionar à agenda": abrem o evento de dia inteiro no vencimento, já
// preenchido, no Google Agenda e no Outlook (Microsoft 365). Só levam texto; o
// PDF segue no e-mail e no convite .ics.
function calendarLinks({ number, value, date, dueDate }) {
  const title = `Vencimento do boleto ${number} — SP Assessoria Contábil`;
  const details = `Boleto ${number} da SP Assessoria Contábil. Valor: ${value}. Vencimento: ${date}. O PDF do boleto está no e-mail enviado por ${SENDER}. Se já pagou, desconsidere.`;
  const next = new Date(`${dueDate}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10);
  const google = new URL("https://calendar.google.com/calendar/render");
  google.search = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${dueDate.replace(/-/g, "")}/${end.replace(/-/g, "")}`, details }).toString();
  const outlook = new URL("https://outlook.office.com/calendar/0/deeplink/compose");
  outlook.search = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: title, body: details, startdt: dueDate, enddt: end, allday: "true" }).toString();
  return { google: google.toString(), outlook: outlook.toString() };
}
// Corpo no layout padrão dos apps da SP (logo, faixa azul, rodapé), com o
// texto simples ao lado para leitores que não abrem HTML.
function emailHtml({ client, number, value, date, dueDate, detail }) {
  const linha = (rotulo, valor) =>
    `<tr><td style="padding:8px 12px; color:#6b7280; font-size:13px; border-bottom:1px solid #eef1f8;">${rotulo}</td><td style="padding:8px 12px; font-weight:bold; text-align:right; border-bottom:1px solid #eef1f8;">${escapeHtml(valor)}</td></tr>`;
  const links = calendarLinks({ number, value, date, dueDate });
  const botao = (href, texto) =>
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:inline-block; background:#0E3BFA; color:#ffffff; font-weight:bold; font-size:14px; padding:12px 20px; border-radius:8px; text-decoration:none; margin:4px;">${texto}</a>`;
  const anexos = detail ? "o boleto em PDF, o demonstrativo da cobrança e" : "o boleto em PDF e";
  const conteudoHtml = [
    `<p style="margin:0 0 12px 0;">Olá${client ? `, <strong>${escapeHtml(client)}</strong>` : ""}.</p>`,
    `<p style="margin:0 0 16px 0;">Segue o seu boleto da SP Assessoria Contábil.</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1FF; border-radius:8px; margin:0 0 16px 0;">${linha("Boleto", number)}${linha("Valor", value)}${linha("Vencimento", date)}</table>`,
    `<p style="margin:0 0 12px 0; font-size:13px; color:#166534; background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:10px 14px;">📎 Em anexo: ${anexos} o convite para a sua agenda, que também leva o boleto.</p>`,
    `<div style="margin:0 0 16px 0; text-align:center;"><p style="margin:0 0 6px 0; font-weight:bold; color:#091D8D;">📅 Adicione o lembrete do vencimento à sua agenda</p>${botao(links.google, "Google Agenda")}${botao(links.outlook, "Outlook")}<p style="margin:6px 0 0 0; font-size:12px; color:#6b7280;">No iPhone, Mac ou Outlook do computador, abra o anexo vencimento-${escapeHtml(number)}.ics.</p></div>`,
    `<p style="margin:0; font-size:13px; color:#92400E; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; padding:10px 14px;">Confira os dados do beneficiário no PDF antes de pagar. Se já pagou, desconsidere esta mensagem.</p>`,
  ].join("");
  return layoutEmail({
    titulo: `Boleto ${escapeHtml(number)}`,
    selo: `Vence ${date}`,
    conteudoHtml,
    assinatura: "Equipe Financeira — SP Assessoria Contábil",
    motivoRodape: "Você recebeu este e-mail porque sua empresa é atendida pelo nosso escritório. Em caso de dúvida, responda este e-mail.",
  });
}
function emailMessage(artifact, { to, idempotencyKey, value, dueDate, client = "" }) {
  const number = artifact.number;
  const date = dueDate.split("-").reverse().join("/");
  const attachments = [
    { name: `boleto-${number}.pdf`, type: "application/pdf", content: artifact.pdf },
    ...(artifact.detail ? [{ name: `demonstrativo-${number}.pdf`, type: "application/pdf", content: artifact.detail }] : []),
    // O convite (.ics) leva o próprio PDF do boleto dentro do evento.
    { name: `vencimento-${number}.ics`, type: "text/calendar", content: Buffer.from(artifact.ics) },
  ];
  return {
    from: SENDER,
    replyTo: SENDER,
    to,
    idempotencyKey,
    subject: `Boleto ${number} — vencimento ${date} — SP Assessoria Contábil`,
    text: `Olá,\n\nSegue o boleto de ${value}, com vencimento em ${date}, e o convite para adicionar o vencimento à sua agenda. O PDF do boleto está anexado e também vai dentro do convite.\n\nConfira os dados do beneficiário no PDF antes de pagar. Se já pagou, desconsidere esta mensagem. Em caso de dúvida, responda a este e-mail.\n\nEquipe Financeira — SP Assessoria Contábil`,
    html: emailHtml({ client: String(client || "").trim(), number, value, date, dueDate, detail: Boolean(artifact.detail) }),
    inline: logoInline(),
    attachments,
  };
}
// Envia o e-mail e registra o resultado. Se a chamada ao Microsoft 365 chegou
// a sair e não houve confirmação, o envio fica "incerto" (não repete sozinho).
async function sendEmail({ env, fetchImpl, message }) {
  let posted = false;
  const tracked = (url, init) => {
    if (String(url).includes("/sendMail")) posted = true;
    return fetchImpl(url, init);
  };
  try {
    const result = await createProvider({ env, fetchImpl: tracked }).send(message);
    return { state: "sent", providerId: result.correlationId };
  } catch (error) {
    return { state: posted ? "unknown" : "failed", error: error.message || "Envio não concluído." };
  }
}
module.exports = {
  DeliveryError,
  CHANNELS,
  contactsFor,
  contactError,
  emailEnabled,
  publicDelivery,
  deliveryKey,
  deliveryRef,
  claim,
  finish,
  emailMessage,
  calendarLinks,
  sendEmail,
  whatsappFrom,
};
