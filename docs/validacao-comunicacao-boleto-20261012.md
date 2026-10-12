# Comunicação Financeiro — validação de 12/10/2026

## Evidências

- Paulo confirmou recebimento do modelo HTML às 11h07 e do teste com PDF às 11h17, na caixa iCloud autorizada.
- Consulta de situação de boleto existente retornou HTTP 200, EM_ABERTO e REGISTRO_CONFIRMADO.
- O novo adaptador local consultou situação, baixou PDF e reconferiu situação. O PDF real possui uma página; metadados correspondem ao número e vencimento esperados.
- Nenhum boleto emitido, lançamento alterado, job persistido ou e-mail adicional enviado na validação do adaptador.
- Relatórios oficiais foram cruzados por documento exato. Prévia local contém 352 boletos e 1.076 cadastros, com divergências e múltiplos destinatários identificados. Os relatórios não substituem consulta atual antes do envio.

## Implementação local

`communication-boleto-source.js` fornece `readSource` e `prepare` para o processador existente. Exige vínculo fornecido pelo servidor, revisão, identidade esperada do boleto e destinatário confirmado. Usa somente GET, sem redirecionamentos. A revisão incorpora vínculo e resposta atual do emissor, detectando alterações durante a preparação. Bloqueia pagamento, baixa, registro ausente, divergência, PDF inválido ou composição não verificável.

O módulo não expõe rota nem ativa agendamento. Credenciais, exportações, PDFs reais e evidências individuais ficam fora do Git. Não foi publicado.

## Pendências para operação automática

1. Implementar carregamento autenticado dos vínculos de lançamentos, conta emissora e contatos confirmados; o teste real usou vínculo exclusivamente em memória.
2. Definir tratamento de múltiplos destinatários e divergências. Não escolher o primeiro e-mail silenciosamente.
3. Ligar configuração, fila, auditoria e processador às fontes reais, com revalidação das permissões. Manter bloqueio de repetição após resultado incerto.
4. Homologar composição real e calendário quando aplicáveis; o teste desta etapa validou PDF do boleto existente.
5. Apresentar commit completo, testes e comparação de contratos protegidos para autorização específica de publicação. Ativação de envios exige escopo e régua definidos.

Consulta antes do envio reduz cobranças indevidas, mas não elimina o intervalo entre pagamento e aceite da mensagem pelo provedor. Não declarar recebimento com base apenas em HTTP 202.
