#!/usr/bin/env bash
# Falha o job se o SonarCloud tiver vulnerabilidade HIGH ou BLOCKER aberta.
set -euo pipefail

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  echo "SONAR_TOKEN ausente. O gate nao libera a entrega."
  exit 1
fi

if [[ -z "${SONAR_PROJECT_KEY:-}" ]]; then
  echo "SONAR_PROJECT_KEY ausente."
  exit 1
fi

api() {
  curl --silent --show-error --fail --user "${SONAR_TOKEN}:" "$@"
}

if [[ -f .scannerwork/report-task.txt ]]; then
  task_id="$(grep '^ceTaskId=' .scannerwork/report-task.txt | cut -d= -f2-)"
  for _ in $(seq 1 36); do
    status="$(api "https://sonarcloud.io/api/ce/task?id=${task_id}" | jq -r '.task.status')"
    case "${status}" in
      SUCCESS) break ;;
      FAILED | CANCELED)
        echo "A analise do SonarCloud terminou com status ${status}."
        exit 1
        ;;
      *) sleep 5 ;;
    esac
  done
  if [[ "${status}" != "SUCCESS" ]]; then
    echo "A analise do SonarCloud nao concluiu a tempo."
    exit 1
  fi
fi

count_issues() {
  api --get "https://sonarcloud.io/api/issues/search" \
    --data-urlencode "componentKeys=${SONAR_PROJECT_KEY}" \
    --data-urlencode "resolved=false" \
    --data-urlencode "ps=1" \
    "$@" | jq -r '.total // empty'
}

by_severity="$(count_issues \
  --data-urlencode "types=VULNERABILITY" \
  --data-urlencode "severities=BLOCKER,HIGH")"
by_impact="$(count_issues \
  --data-urlencode "impactSoftwareQualities=SECURITY" \
  --data-urlencode "impactSeverities=BLOCKER,HIGH")"

if [[ -z "${by_severity}" || -z "${by_impact}" ]]; then
  echo "A API do SonarCloud nao devolveu a contagem de vulnerabilidades."
  exit 1
fi

if [[ "${by_severity}" != "0" || "${by_impact}" != "0" ]]; then
  echo "Vulnerabilidade alta ou bloqueadora encontrada (severidade=${by_severity}, impacto=${by_impact}). Entrega interrompida."
  exit 1
fi

echo "Nenhuma vulnerabilidade alta ou bloqueadora. Entrega liberada pelo gate."
