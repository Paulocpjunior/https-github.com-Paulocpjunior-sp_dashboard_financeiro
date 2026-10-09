"""Read official Boleto Cloud XLS reports; never changes a financial record.

Requires xlrd. Produces a private JSON import payload with per-file checksums.
Usage: python read-boleto-history.py --output /private/history.json reports.XLS ...
"""
import argparse
import datetime as dt
import hashlib
import json
import re
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import xlrd

HEADERS = ['TOKEN', 'CRIAÇÃO', 'BANCO', 'NÚMERO', 'DOCUMENTO', 'PAGADOR CPRF',
           'PAGADOR NOME', 'PAGADOR EMAIL', 'PAGADOR TELEFONE', 'PAGADOR CELULAR',
           'VALOR', 'VENCIMENTO', 'VALOR PAGO', 'DATA PAGAMENTO', 'DATA CREDITO',
           'DATA BAIXA_COBRANCA', 'MOTIVO BAIXA_COBRANCA',
           'DESCRIÇÃO_OCORRÊNCIA BAIXA_COBRANCA', 'INFORMAÇÕES AO PAGADOR']

def cents(value):
    if value == '':
        return None
    return int((Decimal(str(value)) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))

def read_report(path):
    book = xlrd.open_workbook(path)
    records = []
    for sheet in book.sheets():
        assert sheet.row_values(2) == HEADERS, f'Unexpected columns: {sheet.name}'
        match = re.fullmatch(r'Beneficiário ([\d./-]+) (.+)', sheet.cell_value(0, 0))
        assert match, 'Missing beneficiary'
        beneficiary_document, beneficiary_name = match.groups()
        beneficiary_document = re.sub(r'\D', '', beneficiary_document)
        def date(value):
            return xlrd.xldate_as_datetime(value, book.datemode).date().isoformat() if value != '' else None
        sheet_records = []
        footer = None
        for index in range(3, sheet.nrows):
            row = sheet.row_values(index)
            if row[0] == 'QTD TOTAL':
                assert footer is None, 'Repeated footer'
                footer = row
                continue
            if not any(v != '' for v in row):
                continue
            assert footer is None, 'Data after footer'
            assert re.fullmatch(r'[A-Za-z0-9_=\-]{10,200}', str(row[0])), 'Invalid token'
            record = dict(token=row[0], createdAt=date(row[1]), bank=str(row[2]),
                number=str(row[3]), document=str(row[4]), payerDocument=re.sub(r'\D', '', str(row[5])),
                payerName=str(row[6]), amountCents=cents(row[10]), dueDate=date(row[11]),
                paidCents=cents(row[12]), paidAt=date(row[13]), creditedAt=date(row[14]),
                cancelledAt=date(row[15]), cancellationReason=str(row[16]),
                cancellationDescription=str(row[17]), beneficiaryDocument=beneficiary_document,
                beneficiaryName=beneficiary_name, registeredAt=None, protestedAt=None,
                detailsSource='report', syncedAt=None)
            assert record['amountCents'] is not None and record['dueDate'] and record['createdAt'], 'Incomplete row'
            sheet_records.append(record)
        assert footer is not None, 'Missing control totals'
        assert len(sheet_records) == int(footer[1]), 'Count differs from footer'
        assert sum(r['amountCents'] for r in sheet_records) == cents(footer[10]), 'Amount differs from footer'
        assert sum(r['paidCents'] or 0 for r in sheet_records) == cents(footer[12]), 'Paid amount differs from footer'
        records.extend(sheet_records)
    return records

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('files', nargs='+')
    args = parser.parse_args()
    records, sources, seen = [], [], set()
    for name in args.files:
        path = Path(name)
        rows = read_report(path)
        for row in rows:
            assert row['token'] not in seen, 'Overlapping reports: duplicate boleto token'
            seen.add(row['token'])
        records.extend(rows)
        sources.append(dict(name=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), count=len(rows)))
    totals = dict(count=len(records), amountCents=sum(r['amountCents'] for r in records),
                  paidCents=sum(r['paidCents'] or 0 for r in records))
    payload = dict(schemaVersion=1, environment='production', exportedAt=dt.datetime.now(dt.timezone.utc).isoformat(),
                   sources=sources, totals=totals, records=records)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False))
    out.chmod(0o600)
    print(json.dumps(dict(totals=totals, sources=sources), ensure_ascii=False))

if __name__ == '__main__':
    main()
