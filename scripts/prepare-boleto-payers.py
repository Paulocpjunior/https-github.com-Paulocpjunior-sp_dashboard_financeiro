"""Convert official Boleto Cloud payer XLS/CSV into a private review import. No network or database writes."""
import argparse,csv,hashlib,json,re
from pathlib import Path

def convert(path):
    if path.suffix.lower()=='.xls':
        import xlrd
        sheet=xlrd.open_workbook(path).sheet_by_index(0)
        headers=sheet.row_values(0)
        rows=[dict(zip(headers,sheet.row_values(i))) for i in range(1,sheet.nrows)]
    else:
        with path.open(encoding='latin-1',newline='') as f:
            reader=csv.DictReader(f,delimiter=';');headers=reader.fieldnames;rows=list(reader)
    if not {'CPRF','NOME','EMAIL'}.issubset(headers):raise ValueError('Colunas CPRF, NOME e EMAIL obrigatórias')
    return dict(format='boleto-payers-v1',sourceName=path.name,sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),rows=[dict(document=str(r['CPRF']),name=str(r['NOME']),emails=[e.strip() for e in re.split('[;,]',str(r['EMAIL'])) if e.strip()]) for r in rows])
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('report');p.add_argument('output');a=p.parse_args()
    data=convert(Path(a.report));out=Path(a.output);out.write_text(json.dumps(data,ensure_ascii=False),encoding='utf8');out.chmod(0o600);print(json.dumps(dict(rows=len(data['rows']),output=str(out))))
