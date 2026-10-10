import { auth } from "./firebaseConfig";
import { Transaction } from "../types";
export type EntryKind = "pagar" | "receber";
export interface EntryClient {
  id: string;
  client: string;
  clientNumber: string;
  cpfCnpj: string;
}
export interface EntryConfig {
  enabled: boolean;
  attachmentsEnabled: boolean;
  catalog: Record<string, string[]>;
  clients: EntryClient[];
}
export interface EntryAttachment {
  name: string;
  type: string;
  kind: string;
  base64: string;
}
export interface EntryDraft {
  kind: EntryKind;
  clientRegistryId: string;
  bankAccount: string;
  category: string;
  supplier: string;
  date: string;
  dueDate: string;
  description: string;
  amount: string;
  honorarios: string;
  extras: string;
  extraItems?: Array<{ account: string; amount: string }>;
  interestRate: string;
  paid: boolean;
  paidAmount: string;
  paymentDate: string;
  paymentMethod: string;
  deliveryMethod: string;
  receiptMethod: string;
  paidBy: string;
  authorizedBy: string;
  personType: string;
  extraDescription: string;
  observation: string;
  email: string;
  phone: string;
  address: Record<string, string>;
}
export interface EntryReview {
  previewHash: string;
  transaction: Transaction;
  attachments: Array<{ name: string; kind: string; size: number }>;
}
export interface EntryAPI {
  config(): Promise<EntryConfig>;
  preview(
    requestId: string,
    entry: EntryDraft,
    attachments: EntryAttachment[],
  ): Promise<EntryReview>;
  commit(
    requestId: string,
    entry: EntryDraft,
    attachments: EntryAttachment[],
    confirmHash: string,
  ): Promise<{ transaction: Transaction; replayed: boolean }>;
  status(
    requestId: string,
  ): Promise<{ state: string; transaction?: Transaction }>;
}
async function request(path: string, body?: unknown) {
  if (!auth.currentUser) throw new Error("Entre novamente para continuar.");
  const response = await fetch(`/api/financial-entries/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response
    .json()
    .catch(() => ({
      error: "Resposta inválida do serviço. Consulte antes de repetir.",
    }));
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || "Não foi possível concluir."),
      { status: response.status },
    );
  return result;
}
export const nativeEntryAPI: EntryAPI = {
  config: () => request("config"),
  preview: (requestId, entry, attachments) =>
    request("preview", { requestId, entry, attachments }),
  commit: (requestId, entry, attachments, confirmHash) =>
    request("commit", { requestId, entry, attachments, confirmHash }),
  status: (requestId) => request(`requests/${requestId}`),
};

export async function downloadEntryAttachment(id: string, sha256: string) {
  const result = await request(
    `attachments/${encodeURIComponent(id)}/${encodeURIComponent(sha256)}`,
  );
  const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: result.type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = result.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
