// Regras canônicas compartilhadas pelo Dashboard e pelo backend financeiro.
export const parseMoneyValue = (value) => {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : 0;
    if (value === null || value === undefined || value === '')
        return 0;
    let raw = String(value).trim().replace(/[^\d,.-]/g, '');
    if (!raw)
        return 0;
    if (raw.includes(',') && raw.includes('.')) {
        raw = raw.replace(/\./g, '').replace(',', '.');
    }
    else if (raw.includes(',')) {
        raw = raw.replace(',', '.');
    }
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) {
        raw = raw.replace(/\./g, '');
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
};
const normalizeText = (value) => {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
};
const firstPositive = (values) => {
    return values.find((value) => Number.isFinite(value) && value > 0) || 0;
};
export const isPaidStatus = (status) => {
    const normalized = normalizeText(status);
    return ['pago', 'paga', 'recebido', 'quitado', 'liquidado', 'sim', 'ok', 's'].includes(normalized);
};
export const isWixInvoice = (transaction) => {
    const source = normalizeText(transaction.source);
    const id = normalizeText(transaction.id);
    const description = normalizeText(transaction.description);
    const client = normalizeText(transaction.client);
    const invoiceNumber = normalizeText(transaction.wixInvoiceNumber);
    const entityId = normalizeText(transaction.wixEntityId);
    return (source === 'wix' ||
        id.startsWith('wix-inv-') ||
        Boolean(invoiceNumber) ||
        Boolean(entityId) ||
        description.includes('fatura wix') ||
        client.includes('fatura wix'));
};
export const isEntradaTransaction = (transaction) => {
    if (isWixInvoice(transaction))
        return true;
    const movement = normalizeText(transaction.movement);
    const type = normalizeText(transaction.type);
    return (movement === 'entrada' ||
        type.includes('entrada') ||
        type.includes('receber') ||
        (parseMoneyValue(transaction.valueReceived) > 0 && parseMoneyValue(transaction.valuePaid) === 0));
};
export const isSaidaTransaction = (transaction) => {
    if (isWixInvoice(transaction))
        return false;
    const movement = normalizeText(transaction.movement);
    const type = normalizeText(transaction.type);
    return (movement === 'saida' ||
        type.includes('saida') ||
        type.includes('pagar') ||
        (parseMoneyValue(transaction.valuePaid) > 0 && parseMoneyValue(transaction.valueReceived) === 0 && !isEntradaTransaction(transaction)));
};
export const getOriginalAmount = (transaction) => {
    const totalCobranca = parseMoneyValue(transaction.totalCobranca);
    const valorOriginal = parseMoneyValue(transaction.valorOriginal);
    const valueReceived = parseMoneyValue(transaction.valueReceived);
    const valuePaid = parseMoneyValue(transaction.valuePaid);
    const componentTotal = parseMoneyValue(transaction.honorarios) + parseMoneyValue(transaction.valorExtra);
    if (isWixInvoice(transaction)) {
        return firstPositive([valorOriginal, totalCobranca, valueReceived, valuePaid, componentTotal]);
    }
    if (isEntradaTransaction(transaction)) {
        return firstPositive([totalCobranca, valorOriginal, componentTotal, valueReceived, valuePaid]);
    }
    if (isSaidaTransaction(transaction)) {
        return firstPositive([valuePaid, valorOriginal, totalCobranca, componentTotal, valueReceived]);
    }
    return firstPositive([totalCobranca, valorOriginal, valueReceived, valuePaid, componentTotal]);
};
export const getPaidAmount = (transaction) => {
    if (!isPaidStatus(transaction.status))
        return 0;
    if (isEntradaTransaction(transaction)) {
        return firstPositive([
            parseMoneyValue(transaction.valueReceived),
            getOriginalAmount(transaction),
            parseMoneyValue(transaction.valuePaid),
        ]);
    }
    if (isSaidaTransaction(transaction)) {
        return firstPositive([
            parseMoneyValue(transaction.valuePaid),
            getOriginalAmount(transaction),
            parseMoneyValue(transaction.valueReceived),
        ]);
    }
    return firstPositive([
        parseMoneyValue(transaction.valueReceived),
        parseMoneyValue(transaction.valuePaid),
        getOriginalAmount(transaction),
    ]);
};
export const getOutstandingAmount = (transaction) => {
    const outstanding = getOriginalAmount(transaction) - getPaidAmount(transaction);
    return outstanding > 0 ? outstanding : 0;
};
