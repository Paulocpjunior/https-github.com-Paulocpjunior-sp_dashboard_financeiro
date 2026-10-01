#!/usr/bin/env bash
set -euo pipefail
# Executar no Cloud Shell com uma identidade autorizada a criar builds e atualizar este serviço.
cd "$(git rev-parse --show-toplevel)"
task_commit="$(git rev-parse HEAD)"
if [[ "${CHECKLIST_APPROVED_COMMIT:-}" != "$task_commit" ]]; then
  echo 'Informe CHECKLIST_APPROVED_COMMIT igual ao SHA completo da versão revisada.' >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo 'Há alterações não commitadas; não implantar.' >&2
  exit 1
fi
project='gen-lang-client-0888019226'
region='southamerica-east1'
service='jotform-webhook'
backup_dir="$(mktemp -d /tmp/checklist-release-XXXXXX)"
gcloud run services describe "$service" --project="$project" --region="$region" \
  --format='value(spec.template.spec.containers[0].image)' > "$backup_dir/imagem-anterior.txt"
gcloud run services describe "$service" --project="$project" --region="$region" \
  --format='value(status.latestReadyRevisionName)' > "$backup_dir/revisao-anterior.txt"
echo "Referências para reversão: $backup_dir"
npm ci --prefix cloud-run/jotform-webhook
npm test --prefix cloud-run/jotform-webhook
node cloud-run/jotform-webhook/test-checklist.js
# Mantém variáveis, identidade de runtime e política de autenticação existentes.
# A revisão nova não recebe o tráfego normal antes da homologação.
gcloud run deploy "$service" --project="$project" --region="$region" \
  --source=cloud-run/jotform-webhook --no-traffic --tag=checklist-preview
echo 'Revisão criada sem mudar o tráfego normal. Homologar a leitura autenticada antes de promover.'
echo 'Após homologação, promover a revisão testada explicitamente e publicar a interface pelo fluxo oficial.'
