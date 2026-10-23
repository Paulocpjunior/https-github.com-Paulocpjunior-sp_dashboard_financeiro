// Casca de e-mail com a identidade da SP Assessoria, a mesma dos outros apps
// (Consultor Fiscal: sefaz-backend/email-layout.js; Legalização:
// backend/legalizacao-helper.js). Logo INLINE por cid: (imagem hospedada fora
// chega bloqueada no Outlook/Gmail), cores do logo, tabelas e estilo inline
// (Outlook não entende flex/grid), largura 600px.
//
// Os repos não compartilham código: mudança de layout precisa ser feita nas
// cascas de todos os apps.
const fs = require("node:fs");
const path = require("node:path");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const MARCA = {
  nome: "SP Assessoria Contábil",
  departamento: "Departamento Financeiro",
  azul: "#0E3BFA",
  marinho: "#091D8D",
  logoCid: "sp-logo",
};
const CORES = { de: MARCA.azul, ate: MARCA.marinho };

function layoutEmail({ titulo, conteudoHtml, selo, assinatura, departamento = MARCA.departamento, motivoRodape }) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0; padding:0; background:#eef1f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f8; padding:24px 12px;">
 <tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:100%; background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 2px 10px rgba(9,29,141,0.10); font-family:-apple-system,'Segoe UI',Arial,sans-serif;">
   <tr><td style="padding:22px 28px 16px 28px; border-bottom:1px solid #eef1f8;" align="center">
     <img src="cid:${MARCA.logoCid}" alt="${escapeHtml(MARCA.nome)}" width="52" height="74" style="display:block; width:52px; height:74px; max-width:52px; border:0; margin:0 auto 8px auto;">
     <div style="font-size:15px; font-weight:bold; color:${MARCA.marinho}; letter-spacing:0.3px;">${escapeHtml(MARCA.nome)}</div>
     <div style="font-size:11px; color:#7a83a0; text-transform:uppercase; letter-spacing:1px; margin-top:2px;">${escapeHtml(departamento)}</div>
   </td></tr>
   <tr><td style="background:${CORES.ate}; background-image:linear-gradient(135deg, ${CORES.de}, ${CORES.ate}); padding:18px 28px;">
     <div style="color:#ffffff; font-size:18px; font-weight:bold;">${titulo}</div>
     ${selo ? `<div style="margin-top:8px;"><span style="display:inline-block; background:rgba(255,255,255,0.22); color:#ffffff; font-size:12px; font-weight:bold; letter-spacing:0.6px; text-transform:uppercase; padding:5px 12px; border-radius:99px;">${escapeHtml(selo)}</span></div>` : ""}
   </td></tr>
   <tr><td style="padding:24px 28px; color:#1b2340; font-size:14px; line-height:1.55;">
     ${conteudoHtml}
     ${assinatura ? `<p style="font-size:13px; color:#6b7280; margin:18px 0 0 0;">${assinatura}</p>` : ""}
   </td></tr>
   <tr><td style="background:#f6f8fd; padding:18px 28px; text-align:center; border-top:1px solid #eef1f8;">
     <div style="font-size:11px; color:#8a93ad; line-height:1.5;">
       ${escapeHtml(MARCA.nome)} · ${escapeHtml(departamento)}<br>
       ${escapeHtml(motivoRodape)}
     </div>
   </td></tr>
  </table>
 </td></tr>
</table>
</body></html>`;
}

// Logo da SP no cabeçalho (a mesma versão de e-mail do Consultor Fiscal).
// Lido uma vez; se sumir do build, o e-mail sai sem a imagem em vez de quebrar.
let logoCache;
function logoInline() {
  if (logoCache === undefined) {
    try {
      logoCache = { name: "sp-logo.png", type: "image/png", contentId: MARCA.logoCid, content: fs.readFileSync(path.join(__dirname, "assets", "sp-logo-email-2x.png")) };
    } catch (error) {
      console.warn("[email-layout] logo do e-mail não encontrado:", String(error?.message || error));
      logoCache = null;
    }
  }
  return logoCache ? [logoCache] : [];
}

module.exports = { MARCA, escapeHtml, layoutEmail, logoInline };
