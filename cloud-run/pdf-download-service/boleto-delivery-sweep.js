// Envio automático pelo servidor do boleto emitido pelo app que ficou sem
// envio (a tela só espera o registro do banco por cerca de 2 minutos e para se
// for fechada). Só e-mail, só boleto que nunca foi enviado por esse canal:
// enviado, incerto ou com falha continuam com a tela, que exige motivo.
const { config, prepareDelivery, finishEmail } = require("./boleto-cloud");
const delivery = require("./boleto-delivery");

const SWEEP_UID = "system:delivery-sweep";
const WINDOW_MS = 20 * 86400000;
const PAGE = 40;
const MAX_TRIES = 12;
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function runDeliverySweep({ db, env = process.env, fetchImpl = fetch, dryRun = false, deadline = Date.now() + 120000, now = Date.now() }) {
  if (env.BOLETO_DELIVERY_SWEEP_ENABLED !== "true") return { disabled: true };
  const since = Date.parse(env.BOLETO_DELIVERY_SWEEP_SINCE || "");
  if (!since) return { skipped: true, reason: "NO_START_DATE" };
  const cfg = config(env);
  if (cfg.environment !== "production" || !cfg.apiKey || !cfg.accountToken) return { skipped: true, reason: "CONFIGURATION" };
  if (!delivery.emailEnabled(env)) return { skipped: true, reason: "EMAIL_NOT_CONFIGURED" };
  const from = Math.max(since, now - WINDOW_MS);
  const counts = { candidates: 0, sent: 0, pending: 0, skipped: 0, failed: 0, errors: 0 };
  const attention = [];
  const issues = (await db.collection("boletoIssues").where("state", "==", "issued").get()).docs
    .map((d) => d.data())
    .filter((i) => i.environment === "production" && i.token && i.transactionId &&
      i.accountFingerprint === cfg.accountFingerprint && Number(i.attemptAt) >= from)
    .sort((a, b) => a.attemptAt - b.attemptAt);
  for (const existing of issues) {
    if (Date.now() + 30000 >= deadline || counts.candidates >= PAGE) break;
    const id = existing.transactionId;
    const target = delivery.deliveryRef(db, cfg.environment, id, existing.token, "email");
    if ((await target.get()).exists) continue;
    // Espera crescente entre tentativas, para um boleto travado não ocupar a vez dos outros.
    const retryRef = db.collection("boletoDeliverySweep").doc(delivery.deliveryKey(cfg.environment, id, existing.token, "email"));
    const retry = (await retryRef.get()).data() || { tries: 0 };
    if (retry.tries >= MAX_TRIES || retry.nextAt > now) { counts.skipped++; continue; }
    const row = (await db.collection("transactions").doc(id).get()).data();
    if (!row || !(row.dueDate >= today())) { counts.skipped++; continue; }
    const contacts = await delivery.contactsFor(db, row).catch(() => null);
    // Cliente sem e-mail na Regra de faturamento não é erro do job: fica para a equipe.
    if (delivery.contactError(contacts, "email")) { counts.skipped++; continue; }
    counts.candidates++;
    if (dryRun) continue;
    try {
      const prepared = await prepareDelivery({ db, env, fetchImpl, cfg, id, existing, row, channel: "email" });
      const attemptId = await delivery.claim(db, target, {
        uid: SWEEP_UID, channel: "email", to: prepared.contacts.email.join(", "),
        base: { transactionId: id, environment: cfg.environment, number: existing.number || "", profileId: prepared.contacts.profileId, automatic: true },
      });
      const saved = await finishEmail({ db, env, fetchImpl, cfg, id, existing, row, uid: SWEEP_UID, attemptId, ...prepared });
      if (saved.state === "sent") counts.sent++;
      else {
        counts.failed++;
        attention.push({ number: existing.number || "", state: saved.state, reason: saved.error || "Envio não concluído." });
      }
    } catch (error) {
      // Registro ainda não confirmado, emissor fora do ar ou cobrança alterada:
      // nada saiu; tenta de novo com espera crescente.
      const tries = retry.tries + 1, reason = String(error?.message || "Envio automático não concluído.").slice(0, 200);
      await retryRef.set({ tries, nextAt: now + tries * 15 * 60000, reason, number: existing.number || "", updatedAt: new Date().toISOString() });
      if (error?.status) counts.pending++;
      else counts.errors++;
      if (tries >= MAX_TRIES || !error?.status) attention.push({ number: existing.number || "", reason: (tries >= MAX_TRIES ? "Envio automático desistiu: " : "") + reason });
    }
  }
  if (!dryRun)
    await db.collection("boletoReturnJobs").doc("delivery-production").set({
      finishedAt: new Date().toISOString(), counts, attention: attention.slice(0, 50), since: new Date(since).toISOString(),
    });
  return { dryRun, ...counts };
}
module.exports = { runDeliverySweep, SWEEP_UID };
