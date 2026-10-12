"""Read-only contact preview from official Boleto Cloud exports. Never sends or writes Firestore."""
import argparse, csv, datetime as dt, hashlib, html, importlib.util, json, re
from pathlib import Path
from collections import Counter, defaultdict

def emails(raw):
    if not raw or not str(raw).strip(): return [], 'sem_email'
    values = [v.strip().lower() for v in re.split('[;,]', str(raw)) if v.strip()]
    if not values: return [], 'sem_email'
    if any(len(v)>254 or not re.fullmatch(r'[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+', v) for v in values):
        return [], 'email_invalido'
    return sorted(set(values)), None

def classify(row, contacts, today):
    reasons=[]
    document=row['payerDocument']
    matches=contacts.get(document, []) if len(document) in (11,14) else []
    boleto_emails, err=emails(row.get('payerEmail'))
    if err: reasons.append('boleto_'+err)
    cad_emails=[]
    if len(matches)!=1: reasons.append('cadastro_ausente' if not matches else 'cadastro_duplicado')
    else:
        cad_emails, err=emails(matches[0]['EMAIL'])
        if err: reasons.append('cadastro_'+err)
    if boleto_emails and cad_emails and boleto_emails!=cad_emails: reasons.append('emails_divergentes')
    proposed=boleto_emails or cad_emails
    if len(proposed)>1: reasons.append('multiplos_destinatarios')
    if row.get('paidAt') or (row.get('paidCents') or 0)>0: situation='pagamento_identificado'
    elif row.get('cancelledAt'): situation='baixado'
    elif row['dueDate']<today: situation='vencido_no_relatorio'
    else: situation='a_vencer_no_relatorio'
    return dict(client=row['payerName'],beneficiary=row.get('beneficiaryName',''),document=document,number=row['number'],dueDate=row['dueDate'],
        amountCents=row['amountCents'],boletoEmails=boleto_emails,cadastroEmails=cad_emails,
        proposedRecipients=proposed,situation=situation,review=reasons,
        proposedAt=(row['dueDate']+'T09:00:00-03:00') if situation=='a_vencer_no_relatorio' and not reasons else None,
        sendEnabled=False,requiresLiveValidation=True,
        reference=hashlib.sha256(row['token'].encode()).hexdigest(),source=row.get('source',''))

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--payers',required=True);ap.add_argument('--output',required=True)
    ap.add_argument('--today',default=dt.date.today().isoformat());ap.add_argument('reports',nargs='+')
    args=ap.parse_args(); dt.date.fromisoformat(args.today)
    import xlrd
    spec=importlib.util.spec_from_file_location('history',Path(__file__).with_name('read-boleto-history.py'))
    history=importlib.util.module_from_spec(spec);spec.loader.exec_module(history)
    contacts=defaultdict(list)
    if Path(args.payers).suffix.lower()=='.xls':
        sheet=xlrd.open_workbook(args.payers).sheet_by_index(0)
        headers=sheet.row_values(0)
        if not {'CPRF','NOME','EMAIL'}.issubset(headers): raise ValueError('Colunas do cadastro inesperadas')
        payer_rows=[dict(zip(headers,sheet.row_values(i))) for i in range(1,sheet.nrows)]
    else:
        with open(args.payers,encoding='latin-1',newline='') as f:
            reader=csv.DictReader(f,delimiter=';')
            if not {'CPRF','NOME','EMAIL'}.issubset(reader.fieldnames): raise ValueError('Colunas do cadastro inesperadas')
            payer_rows=list(reader)
    for r in payer_rows:
        contacts[re.sub(r'\D','',r['CPRF'])].append(r)
    rows=[];seen={};sources=[];duplicates=0
    for path in map(Path,args.reports):
        parsed=history.read_report(path) # verifies count and financial footer totals
        email_by_token={}
        for sheet in xlrd.open_workbook(path).sheets():
            for i in range(3,sheet.nrows):
                vals=sheet.row_values(i)
                if vals[0] and vals[0]!='QTD TOTAL': email_by_token[vals[0]]=str(vals[7])
        for r in parsed:
            r['payerEmail']=email_by_token[r['token']]
            if r['token'] in seen:
                if seen[r['token']]!=r: raise ValueError('Versões divergentes do mesmo boleto; atualização necessária')
                duplicates+=1;continue
            seen[r['token']]=dict(r);r['source']=path.name
            rows.append(classify(r,contacts,args.today))
        sources.append(dict(name=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),count=len(parsed)))
    sources.append(dict(name=Path(args.payers).name,sha256=hashlib.sha256(Path(args.payers).read_bytes()).hexdigest()))
    counts=dict(Counter(r['situation'] for r in rows)); reviews=dict(Counter(x for r in rows for x in r['review']))
    result=dict(generatedAt=dt.datetime.now(dt.timezone.utc).isoformat(),asOf=args.today,
        mode='export-preview-only',sendEnabled=False,schedule='Proposta: dia do vencimento às 09h de São Paulo. Não agendada.',
        sources=sources,identicalDuplicates=duplicates,counts=counts,reviewCounts=reviews,payerRows=sum(map(len,contacts.values())),rows=rows)
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(result,ensure_ascii=False),encoding='utf8');out.chmod(0o600)
    displayed=sorted((r for r in rows if r['situation'] not in ('pagamento_identificado','baixado')),key=lambda r:(r['dueDate'],r['client']))
    esc=lambda v:html.escape(str(v))
    labels={'multiplos_destinatarios':'Mais de um destinatário','emails_divergentes':'E-mails diferentes entre boleto e cadastro','boleto_sem_email':'Boleto sem e-mail','cadastro_sem_email':'Cadastro sem e-mail','boleto_email_invalido':'Formato do e-mail do boleto a revisar','cadastro_email_invalido':'Formato do e-mail do cadastro a revisar','cadastro_ausente':'Cadastro não localizado','cadastro_duplicado':'CPF/CNPJ com mais de um cadastro','vencido_no_relatorio':'Vencido','a_vencer_no_relatorio':'A vencer ou vence hoje'}
    def contact_display(r, field, prefix):
        return '; '.join(r[field]) or ('Formato a revisar' if prefix+'_email_invalido' in r['review'] else 'Ausente')
    def brdate(value): return dt.date.fromisoformat(value).strftime('%d/%m/%Y')
    body=''.join('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in [r['client'],r['beneficiary'],r['number'],brdate(r['dueDate']),('R$ '+format(r['amountCents']/100,',.2f')).replace(',','X').replace('.',',').replace('X','.'),contact_display(r,'boletoEmails','boleto'),contact_display(r,'cadastroEmails','cadastro'),labels.get(r['situation'],r['situation']),'; '.join(labels.get(x,x) for x in r['review']) or 'Contatos coincidem',(brdate(r['dueDate'])+' às 09h (proposta)') if r['proposedAt'] else 'Sem proposta'])+'</tr>' for r in displayed)
    page='''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Prévia de comunicação Financeiro</title><style>body{font:15px system-ui;margin:32px;color:#172554;background:#f8fafc}h1{font-size:28px}aside{padding:20px;background:#fff3cd;border-radius:10px}table{min-width:1800px;width:100%;border-collapse:collapse;background:white;margin-top:20px}td,th{min-width:90px;padding:12px;text-align:left;border-bottom:1px solid #ddd;overflow-wrap:anywhere}th{background:#172554;color:white;position:sticky;top:0}input{padding:12px;width:420px;max-width:90%;margin-top:20px}details{margin:20px 0}code{overflow-wrap:anywhere}</style><h1>Prévia de e-mails de cobrança</h1><aside>Prévia dos relatórios exportados. Nenhum envio ou agendamento realizado. Situação válida no momento da exportação; exige nova consulta antes de enviar. Antes da ativação, atualizar o cadastro, consultar cada boleto e conferir destinatários. Boletos com pagamento ou baixa no relatório não aparecem na lista abaixo.</aside>'''
    page+='<p>Data de referência: '+esc(args.today)+'</p><p>'+esc(result['schedule'])+'</p><p>'+esc(' • '.join(f'{v} {k.replace("_no_relatorio","").replace("_"," ")}' for k,v in counts.items()))+'</p><input aria-label="Pesquisar cliente ou boleto" placeholder="Pesquisar cliente, boleto ou pendência"><div style="overflow-x:auto"><table><thead><tr>'+''.join('<th>'+x+'</th>' for x in ['Cliente','Beneficiário','Boleto','Vencimento','Valor','E-mail no boleto','E-mail no cadastro','Situação na exportação','Revisão','Envio proposto'])+'</tr></thead><tbody>'+body+'</tbody></table></div>'
    page+='<details><summary>Fontes e conferência</summary><pre>'+esc(json.dumps(sources,ensure_ascii=False,indent=2))+'</pre></details><script>document.querySelector("input").addEventListener("input",function(){for(const r of document.querySelectorAll("tbody tr"))r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase())})</script></html>'
    htmlpath=out.with_suffix('.html');htmlpath.write_text(page,encoding='utf8');htmlpath.chmod(0o600)
    print(json.dumps(dict(counts=counts,reviewCounts=reviews,payerRows=result['payerRows'],displayed=len(displayed),proposed=sum(bool(r['proposedAt']) for r in rows)),ensure_ascii=False))
if __name__=='__main__':main()
