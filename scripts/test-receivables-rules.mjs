import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
// Never connect this suite to production. Isolated fallback supports shared worktrees.
let require = createRequire(import.meta.url);
try { require.resolve('@firebase/rules-unit-testing'); } catch {
  require = createRequire(new URL('../.tmp/security-tests/package.json', import.meta.url));
}
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  collection,
  where,
  updateDoc,
  getCountFromServer,
} = require("firebase/firestore");
if (!process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error("FIRESTORE_EMULATOR_HOST is required.");
const env = await initializeTestEnvironment({
  projectId: "demo-financeiro-receivables",
  firestore: {
    rules: await readFile(
      new URL("../firestore.rules", import.meta.url),
      "utf8",
    ),
  },
});
try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [id, profile] of Object.entries({
      admin: { role: "admin", active: true },
      operator: {
        role: "operacional",
        active: true,
        financialPermissions: [
          "itau.openfinance.read",
          "itau.statement.import",
          "wix.treasury.open",
        ],
      },
      inactive: { role: "operacional", active: false },
      blocked: { role: "operacional", active: true, status: "blocked" },
    }))
      await setDoc(doc(db, "users", id), profile);
    for (const [id, movement, type] of [
      ["receipt", "Entrada", "Entrada de Caixa / Contas a Receber"],
      ["expense", "Saída", "Saída de Caixa / Contas a Pagar"],
      ["ambiguous", "Entrada", "Saída de Caixa / Contas a Pagar"],
    ])
      await setDoc(doc(db, "transactions", id), {
        movement,
        type,
        status: "Pendente",
        date: "2026-09-18",
        valuePaid: 100,
        valueReceived: 100,
      });
    await setDoc(doc(db, "bankStatements", "account", "entries", "bank"), {
      amountCents: -10000,
    });
  });
  const operator = env.authenticatedContext("operator").firestore();
  await assertSucceeds(getDoc(doc(operator, "transactions", "receipt")));
  await assertFails(getDoc(doc(operator, "transactions", "expense")));
  await assertFails(getDoc(doc(operator, "transactions", "ambiguous")));
  await assertFails(getDocs(collection(operator, "transactions")));
  await assertFails(getCountFromServer(collection(operator, "transactions")));
  await assertFails(
    getDocs(
      query(
        collection(operator, "transactions"),
        where("movement", "==", "Entrada"),
      ),
    ),
  );
  await assertSucceeds(
    getDocs(
      query(
        collection(operator, "transactions"),
        where("movement", "==", "Entrada"),
        where("type", "==", "Entrada de Caixa / Contas a Receber"),
      ),
    ),
  );
  await assertSucceeds(
    updateDoc(doc(operator, "transactions", "receipt"), {
      status: "Pago",
      paymentDate: "2026-09-18",
    }),
  );
  await assertFails(
    updateDoc(doc(operator, "transactions", "expense"), { status: "Pago" }),
  );
  await assertFails(
    updateDoc(doc(operator, "transactions", "receipt"), { movement: "Saída" }),
  );
  await assertFails(
    updateDoc(doc(operator, "users", "operator"), { role: "admin" }),
  );
  await assertFails(
    getDoc(doc(operator, "bankStatements", "account", "entries", "bank")),
  );
  for (const id of ["inactive", "blocked"])
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext(id).firestore(),
          "transactions",
          "receipt",
        ),
      ),
    );
  await assertFails(
    getDoc(
      doc(env.unauthenticatedContext().firestore(), "transactions", "receipt"),
    ),
  );
  await assertSucceeds(
    getDocs(
      collection(env.authenticatedContext("admin").firestore(), "transactions"),
    ),
  );
  console.log(
    "PASS: operators see receipts only; payables, totals, bank data, role escalation and inactive access denied.",
  );
} finally {
  await env.cleanup();
}
