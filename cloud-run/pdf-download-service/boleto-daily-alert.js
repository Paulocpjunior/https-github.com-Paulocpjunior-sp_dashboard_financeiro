// Alerta diário para o Paulo: tudo que pode deixar o faturamento errado ou
// incompleto sem ninguém perceber (boleto sem envio, envio incerto, emissão
// sem confirmação, retorno em conferência, robô com erro). Sai uma vez por dia,
// a partir das 8h, mesmo sem pendência, para provar que o alerta funciona.
const PDFDocument = require("pdfkit");
const { createHash } = require("node:crypto");
const { config } = require("./boleto-cloud");
const delivery = require("./boleto-delivery");
const { createProvider } = require("./communication-provider");
const { SENDER } = require("./communication-rule");
const { recipients } = require("./communication-recipients");
const { escapeHtml, layoutEmail, logoInline } = require("./email-layout");

const DAY_MS = 86400000;
const WINDOW_MS = 20 * DAY_MS;
const SEND_HOUR = 8;
const local = (ms, opts) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", ...opts }).format(new Date(ms));
const dayOf = (ms) => local(ms, { year: "numeric", month: "2-digit", day: "2-digit" });
const hourOf = (ms) => Number(local(ms, { hour: "2-digit", hourCycle: "h23" }));
const br = (day) => day.split("-").reverse().join("/");

// Contagem de execuções do job por dia, para o alerta dizer quantas falharam.
async function recordRun(db, failed, now = Date.now()) {
  const ref = db.collection("boletoReturnJobs").doc(`runs-${dayOf(now)}`);
  await db.runTransaction(async (tx) => {
    const old = (await tx.get(ref)).data() || { runs: 0, failed: 0 };
    tx.set(ref, { day: dayOf(now), runs: old.runs + 1, failed: old.failed + (failed ? 1 : 0), updatedAt: new Date(now).toISOString() });
  });
}

async function collect(db, cfg, now) {
  const findings = [];
  const add = (title, items, detail = "") => { if (items.length) findings.push({ title, count: items.length, items: items.slice(0, 40), detail }); };
  const issues = (await db.collection("boletoIssues").get()).docs.map((d) => d.data())
    .filter((i) => i.environment === "production" && i.accountFingerprint === cfg.accountFingerprint && Number(i.attemptAt) >= now - WINDOW_MS);
  add("Emissão sem confirmação há mais de 10 minutos (não emitir de novo; usar Recuperar tentativa)",
    issues.filter((i) => ["issuing", "unknown"].includes(i.state) && now - Number(i.attemptAt) > 600000).map((i) => i.transactionId));
  const noEmail = [], printed = [], uncertain = [];
  for (const issue of issues.filter((i) => i.state === "issued" && i.token)) {
    const row = (await db.collection("transactions").doc(issue.transactionId).get()).data();
    if (!row || row.isExcluded || Number(row.valueReceived) > 0 || !(row.dueDate >= dayOf(now))) continue;
    const label = `${issue.number || "sem número"} · ${row.client || issue.transactionId} · vence ${br(row.dueDate)}`;
    const sent = (await delivery.deliveryRef(db, cfg.environment, issue.transactionId, issue.token, "email").get()).data();
    if (sent && ["failed", "unknown", "sending"].includes(sent.state)) { uncertain.push(`${label} · ${sent.state === "failed" ? "falhou" : "sem confirmação"}`); continue; }
    if (sent) continue;
    if (now - Number(issue.attemptAt) < 3600000) continue;
    const contacts = await delivery.contactsFor(db, row).catch(() => null);
    if (delivery.contactError(contacts, "email")) {
      if (!contacts?.channels?.includes("whatsapp")) printed.push(label);
    } else noEmail.push(label);
  }
  add("Boleto emitido com e-mail no cadastro e ainda não enviado (mais de 1 hora)", noEmail);
  add("Envio por e-mail com falha ou sem confirmação (conferir antes de reenviar)", uncertain);
  add("Boleto emitido sem envio digital (cadastro com envio Impresso ou sem e-mail)", printed,
    "Conferir se o cliente recebe o boleto impresso ou se falta marcar e-mail na Regra de faturamento.");
  const events = (await db.collection("boletoReturnEvents").where("state", "in", ["review", "error"]).get()).docs.map((d) => d.data());
  add("Retorno do banco em conferência (pagamento que o robô não baixou)",
    events.map((e) => `${e.number || "sem número"} · ${e.state === "error" ? "erro de consulta" : String(e.reason || "").slice(0, 120)}`));
  const files = (await db.collection("boletoReturnFiles").where("state", "==", "pending").get()).docs.map((d) => d.data());
  add("Arquivo de retorno do banco ainda não concluído", files.map((f) => `${f.date || "sem data"} · ${f.lastError || "aguardando conferência"}`));
  for (const [doc, title] of [["history-production", "Consulta do histórico com atenção"], ["delivery-production", "Envio automático com atenção"]]) {
    const job = (await db.collection("boletoReturnJobs").doc(doc).get()).data();
    add(title, (job?.attention || []).map((a) => `${a.number || ""} · ${a.reason || ""}`));
  }
  const runs = [dayOf(now - DAY_MS), dayOf(now)];
  const stats = [];
  for (const day of runs) {
    const r = (await db.collection("boletoReturnJobs").doc(`runs-${day}`).get()).data();
    if (r?.failed) stats.push(`${br(day)}: ${r.failed} de ${r.runs} execuções com erro`);
  }
  add("Robô de baixas com execução em erro", stats, "As baixas continuam se o erro for só do histórico; conferir os itens acima.");
  return findings;
}

function pdfReport(day, findings) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Alertas do Financeiro ${br(day)}` } });
    const parts = [];
    doc.on("data", (c) => parts.push(c));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.on("error", reject);
    doc.fontSize(16).text(`Alertas do Financeiro — ${br(day)}`);
    doc.moveDown(0.5).fontSize(10).text(findings.length ? `${findings.length} ponto(s) para conferir.` : "Nenhuma pendência encontrada.");
    for (const f of findings) {
      doc.moveDown().fontSize(12).text(`${f.title} (${f.count})`);
      if (f.detail) doc.fontSize(9).text(f.detail);
      doc.fontSize(9);
      for (const item of f.items) doc.text(`• ${item}`);
      if (f.count > f.items.length) doc.text(`… e mais ${f.count - f.items.length}.`);
    }
    doc.end();
  });
}

async function runDailyAlert({ db, env = process.env, fetchImpl = fetch, dryRun = false, now = Date.now() }) {
  const to = String(env.BOLETO_DAILY_ALERT_EMAIL || "").split(/[;,\s]+/).filter(Boolean);
  if (!to.length) return { disabled: true };
  if (!delivery.emailEnabled(env)) return { skipped: true, reason: "EMAIL_NOT_CONFIGURED" };
  const cfg = config(env);
  if (cfg.environment !== "production") return { skipped: true, reason: "CONFIGURATION" };
  const day = dayOf(now);
  if (hourOf(now) < SEND_HOUR) return { waiting: true };
  const ref = db.collection("boletoReturnJobs").doc("alert-production");
  const current = (await ref.get()).data() || {};
  if (current.lastDay === day) return { alreadySent: day };
  if (current.failedDay === day && current.failures >= 3) return { gaveUp: day };
  const findings = await collect(db, cfg, now);
  if (dryRun) return { dryRun, findings: findings.length };
  // Reserva o dia antes de enviar: no máximo um alerta por dia, mesmo com execuções simultâneas.
  const claimed = await db.runTransaction(async (tx) => {
    const old = (await tx.get(ref)).data() || {};
    if (old.lastDay === day) return false;
    tx.set(ref, { ...old, lastDay: day, state: "sending", findings: findings.map((f) => ({ title: f.title, count: f.count })), updatedAt: new Date().toISOString() });
    return true;
  });
  if (!claimed) return { alreadySent: day };
  const pdf = await pdfReport(day, findings);
  const lines = findings.map((f) => `<li style="margin:0 0 6px 0;"><strong>${escapeHtml(f.title)}</strong>: ${f.count}</li>`).join("");
  const conteudoHtml = findings.length
    ? `<p style="margin:0 0 12px 0;">Paulo, ${findings.length} ponto(s) do faturamento precisam de conferência hoje:</p><ul style="margin:0 0 12px 18px; padding:0;">${lines}</ul><p style="margin:0; font-size:13px;">A lista completa, boleto por boleto, está no PDF anexo.</p>`
    : `<p style="margin:0;">Paulo, nenhuma pendência encontrada no faturamento hoje. Este e-mail confirma que o alerta diário está funcionando.</p>`;
  const text = findings.length
    ? `Paulo, ${findings.length} ponto(s) do faturamento precisam de conferência hoje:\n\n${findings.map((f) => `- ${f.title}: ${f.count}`).join("\n")}\n\nA lista completa está no PDF anexo.`
    : "Paulo, nenhuma pendência encontrada no faturamento hoje. Este e-mail confirma que o alerta diário está funcionando.";
  let state = "sent", error = "";
  try {
    await createProvider({ env, fetchImpl }).send({
      from: SENDER, replyTo: SENDER, to: recipients(to),
      idempotencyKey: createHash("sha256").update(JSON.stringify(["daily-alert", day])).digest("hex"),
      subject: `Financeiro — alertas de ${br(day)}: ${findings.length ? `${findings.length} ponto(s) para conferir` : "sem pendências"}`,
      text,
      html: layoutEmail({ titulo: "Alertas do faturamento", selo: br(day), conteudoHtml, assinatura: "Robô do Financeiro — SP Assessoria Contábil", motivoRodape: "Alerta interno diário do Financeiro." }),
      inline: logoInline(),
      attachments: [{ name: `alertas-financeiro-${day}.pdf`, type: "application/pdf", content: pdf }],
    });
  } catch (e) {
    state = "failed";
    error = String(e?.message || "Envio não concluído.").slice(0, 200);
  }
  // Falha libera o dia para nova tentativa no próximo ciclo (até 3 por dia).
  const failures = state === "sent" ? 0 : (current.failedDay === day ? current.failures || 0 : 0) + 1;
  await ref.set({ lastDay: state === "sent" ? day : current.lastDay || null, state, error, failedDay: state === "sent" ? null : day, failures,
    findings: findings.map((f) => ({ title: f.title, count: f.count })), updatedAt: new Date().toISOString() });
  return { state, findings: findings.length, errors: state === "sent" ? 0 : 1 };
}
module.exports = { runDailyAlert, recordRun, collect };
