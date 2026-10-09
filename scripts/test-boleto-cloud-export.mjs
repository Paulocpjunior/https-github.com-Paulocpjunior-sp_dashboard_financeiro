import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const table = readFileSync("components/DataTable.tsx", "utf8");
const modal = readFileSync("components/BoletoIssueModal.tsx", "utf8");
const dashboard = readFileSync("pages/Dashboard.tsx", "utf8");
const config = JSON.parse(readFileSync("firebase.json", "utf8"));
assert.ok(
  config.hosting.rewrites.some(
    (r) =>
      r.source === "/api/boleto-cloud/**" &&
      r.run?.serviceId === "sp-pdf-download",
  ),
);
assert.match(table, /canExportBoletoCloud = false/);
assert.match(table, /<BoletoIssueModal/);
assert.doesNotMatch(table, /handleGenerateCSV|Preparar CSV|boleto-cloud-csv/);
assert.match(
  dashboard,
  /hasFinancialPermission\(currentUser, 'billing\.boleto-cloud\.issue'\)/,
);
assert.match(modal, /user.getIdToken\(\)/);
assert.match(modal, /legacyChecked:\s*checked/);
assert.doesNotMatch(
  modal,
  /api-key_|BOLETO_CLOUD_API_KEY|BOLETO_CLOUD_ACCOUNT_TOKEN/,
);
assert.match(modal, /URL.revokeObjectURL/);
console.log(
  "Emissão direta: permissão, rota, confirmação e ausência de exportação CSV verificadas.",
);
