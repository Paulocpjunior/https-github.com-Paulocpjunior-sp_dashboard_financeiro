# Conferência individual de boletos e RET

## Regra

A automação compara a emissão individual registrada no Financeiro/Boleto Cloud, o lançamento vinculado, a ocorrência de liquidação do RET disponibilizada pelo emissor e a situação individual do boleto. O extrato agregado da conta não identifica nem baixa títulos individuais. Não há importador novo de arquivo de remessa nesta alteração.

- Identidade, vínculo, valor e pagamento bancário coincidentes: baixa automática, preservando o identificador da ocorrência e a auditoria.
- Boleto aberto/sem liquidação: continua pendente. Não registrar recebimento presumido.
- Valor, juros, identidade ou retorno divergente: revisão manual; não bloquear os outros títulos do arquivo.
- Alteração ou remoção de evidência já recebida: preservar o original e a versão recebida, bloquear o título também em outros arquivos e mostrar a divergência.
- Recebimento já registrado: conferir o histórico. Não registrar outra baixa. Correção de baixa manual usa o estorno existente; registros bancários/legados continuam exigindo conferência específica.

O job agendado permite baixas automáticas somente pela etapa RET. As consultas de situação atualizam o histórico, sem liquidar por uma rota paralela.

## Colaborador

1. Abra **Conferência individual do RET** e atualize as pendências.
2. Leia o motivo e compare o retorno anterior/atual, quando houver. Abra os candidatos e confira CPF/CNPJ, vencimento, valor e histórico; a sugestão não confirma o vínculo.
3. Havendo saldo e recebimento comprovado, clique **Registrar recebimento manual**.
4. Informe data, valor recebido, conta, forma real (conforme o catálogo), juros, multa e desconto. Descreva o ocorrido e a referência do comprovante.
5. Revise o saldo e confirme. O histórico guarda usuário, valores e referência ao RET. Pagamento parcial mantém a conta e a ocorrência em revisão.
6. Se a conta já estiver paga, use **Conferir recebimento existente**. Não há uma ação de encerrar divergências legadas sem evidência; esses casos permanecem para conferência/correção específica.

Exemplo: título de R$ 500,00 e crédito de R$ 550,96 com juros divergentes no RET. O colaborador confirma o comprovante e discrimina o acréscimo real; o sistema não presume que os R$ 50,96 sejam juros. PIX, depósito, transferência ou dinheiro exigem a identificação da forma efetiva. Registrar no Financeiro não cancela o boleto no banco.

## Controles técnicos

- Operações com prévia, hash de versão, confirmação, idempotência e auditoria.
- Vínculos existentes de emissão/reconciliação impedem aplicação a outra conta.
- `boletoManualResolutions` conserva a reserva do título e impede retorno automático após intervenção manual, inclusive estorno; incluída no backup e bloqueada para acesso direto pelas regras padrão.
- `interestCents` do saldo legado mantém o total dos encargos; `fineCents` discrimina a multa no recebimento. A tela mostra juros sem duplicar a multa.
- Exclusão continua restrita à regra existente. Envios automáticos não são ativados.

## Validação desta alteração

Testes com dados sintéticos cobrem isolamento de ocorrências, preservação de evidência, repetição, parcial, estorno, multa, CPF/CNPJ divergente, vínculo com outra conta e bloqueio de caminhos paralelos. Conferência visual local dos componentes; sem alterações em lançamentos reais. A validação autenticada após implantação e a observação do ciclo agendado permanecem necessárias.
