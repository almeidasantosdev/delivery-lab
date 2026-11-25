# Delivery Lab

Laboratorio de entrega continua. Uma API em NestJS recebe um webhook de pagamento, grava o evento uma unica vez e deixa a entrega numa tabela outbox. Um worker publica essa linha no RabbitMQ e consome a fila. Se o provedor simulado falha, a mensagem volta com espera crescente. Na quinta falha ela vai para a dead-letter queue. Prometheus le as metricas e o Grafana mostra se a API esta no ar.

Os dados sao ficticios. Nao ha chave de pagamento, cliente real nem segredo de producao.

## O que faz

1. `POST /webhooks/payments` grava o evento, o job e uma linha no outbox na mesma transacao. A mesma chave, enviada de novo, devolve o job que ja existe e nao cria outro.
2. O worker publica o outbox no RabbitMQ com `FOR UPDATE SKIP LOCKED`, para dois publicadores nao enviarem a mesma linha ao mesmo tempo.
3. O consumidor le a fila `delivery.jobs`. O provedor e simulado. `fail_until_attempt` diz quantas tentativas iniciais devem falhar com `provider_timeout`. Depois disso o job fica `delivered`.
4. Cada falha publica a proxima tentativa numa fila com TTL: 1s, 2s, 4s, ate o teto de 60s. Na quinta falha o job fica `failed` e a mensagem vai para `delivery.jobs.dlq`.
5. Se o worker morre depois de reservar a tentativa, o RabbitMQ reentrega a mensagem e o consumidor conclui essa mesma tentativa.
6. `GET /metrics` na API e no worker expoe contadores para o Prometheus.

O log registra a chave e o id do job. O corpo do webhook nao entra no log.

## Tecnologias

| Parte | Ferramenta |
| --- | --- |
| API | Node.js 22, TypeScript, NestJS |
| Banco | PostgreSQL 16 |
| Fila | Outbox no Postgres e RabbitMQ, com retry e DLQ |
| Worker | Processo separado, consome `delivery.jobs` |
| Metricas | @prometheus-io/client, Prometheus, Grafana |
| Empacotamento | Dockerfile multi-stage, usuario `node`, Docker Compose |
| Esteira | GitHub Actions, Azure Pipelines, Trivy, gitleaks, SonarCloud |
| Nuvem | Terraform: VPC, EC2 e bucket S3 privado na AWS |
| Testes | Jest. Integracao com Postgres e RabbitMQ no GitHub Actions |
| Cluster | Manifestos no repositorio irmao `delivery-lab-k8s` |

Decisoes curtas estao em `docs/adr/`.

## Arquitetura

```mermaid
flowchart LR
  cliente[Cliente] --> api[API NestJS]
  api --> postgres[(PostgreSQL)]
  worker[Worker] --> postgres
  worker --> rabbit[RabbitMQ]
  rabbit --> worker
  api --> prometheus[Prometheus]
  worker --> prometheus
  prometheus --> grafana[Grafana]
  push[git push] --> actions[GitHub Actions]
  actions --> imagem[Imagem Docker]
  terraform[Terraform] --> aws[EC2 e S3]
```

A esteira constroi e analisa a imagem. Ela ainda nao publica a imagem nem aplica o Terraform. A EC2 sobe com o Docker instalado. Colocar o container nessa maquina e o passo seguinte, com registro e credencial configurados de proposito.

## Como utilizar

### Pre-requisitos

- Node.js 22 ou superior, para testar e rodar a API fora do Docker
- Docker Compose v2, para subir API, worker, PostgreSQL, RabbitMQ, Prometheus e Grafana
- Terraform 1.5 ou superior e credenciais AWS, somente se for criar a infraestrutura

### 1. Testar

Na raiz do repositorio, os testes unitarios nao precisam de Docker:

```powershell
npm ci
npm test
```

O teste de integracao usa o Postgres e o RabbitMQ do Compose. Ele apaga as tabelas `webhook_events`, `delivery_jobs` e `outbox` do banco apontado por `DATABASE_URL`.

```powershell
docker compose up -d postgres rabbitmq
$env:DATABASE_URL = "postgres://delivery:delivery@localhost:5433/delivery"
$env:RABBITMQ_URL = "amqp://delivery:delivery@localhost:5672"
npm run test:integration
```

No GitHub Actions, o job `test` sobe os dois servicos e roda as duas suites. O cenario cobre idempotencia, publicacao, consumo com retentativa e a DLQ.

### 2. Subir o laboratorio

```powershell
docker compose up --build
```

| Servico | Endereco | Acesso local |
| --- | --- | --- |
| API | http://localhost:3000 | sem login |
| Worker | http://localhost:3002 | sem login, `/health` e `/metrics` |
| Grafana | http://localhost:3001 | `admin` / `admin` |
| Prometheus | http://localhost:9090 | sem login |
| RabbitMQ | `localhost:5672` | usuario `delivery`, senha `delivery` |
| PostgreSQL | `localhost:5433` | usuario `delivery`, senha `delivery`, banco `delivery` |

Essa senha vale apenas para o Compose na sua maquina. O bucket da AWS nasce fechado para acesso publico.

O dashboard **Delivery Lab** ja vem provisionado. Envie algum trafego e aguarde um scrape de 5 segundos para os graficos sairem do zero.

### 3. Chamar a API

Com a stack no ar:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\demo.ps1
```

O script cria uma chave, envia o webhook duas vezes e espera o worker entregar. A primeira resposta vem com `duplicate: false` e status HTTP 202. A segunda vem com `duplicate: true`, o mesmo `job_id` e status HTTP 200.

O mesmo fluxo, pedido a pedido:

```powershell
Invoke-RestMethod http://localhost:3000/health

$corpo = @{
  idempotency_key    = "evt_001"
  event_type         = "payment.confirmed"
  fail_until_attempt = 2
  payload            = @{ amount_cents = 1500 }
} | ConvertTo-Json

Invoke-RestMethod http://localhost:3000/webhooks/payments -Method Post -ContentType "application/json" -Body $corpo
Invoke-RestMethod http://localhost:3000/webhooks/evt_001
```

`fail_until_attempt: 2` faz as duas primeiras tentativas falharem. Com o worker em intervalo de 2 segundos, a entrega conclui depois da terceira tentativa. Acompanhe em `GET /webhooks/evt_001`: `job.attempts` sobe e `job.last_error` fica `provider_timeout` ate o status do evento virar `delivered`.

Corpo aceito:

| Campo | Obrigatorio | Significado |
| --- | --- | --- |
| `idempotency_key` | sim | Texto de 1 a 200 caracteres. Repetir a chave nao cria outro job. |
| `event_type` | sim | Nome do evento, por exemplo `payment.confirmed`. |
| `payload` | nao | Objeto livre. O padrao e `{}`. |
| `fail_until_attempt` | nao | Inteiro de 0 a 10. Quantas tentativas iniciais o provedor simulado recusa. |

Consultas:

- `GET /health` — confirma a API e o banco
- `GET /webhooks/:key` — evento e job
- `GET /jobs/:id` — so o job
- `GET /metrics` — texto no formato do Prometheus

### 4. Rodar fora do Compose

Suba o Postgres e o RabbitMQ, ou use o que o Compose ja publicou.

```powershell
Copy-Item .env.example .env
$env:DATABASE_URL = "postgres://delivery:delivery@localhost:5433/delivery"
$env:RABBITMQ_URL = "amqp://delivery:delivery@localhost:5672"
npm ci
npm start
```

`npm start` aplica o schema e abre a API na porta 3000. Em outro terminal, `npm run start:worker` publica o outbox e consome o RabbitMQ. `npm run migrate` aplica o schema e encerra. Sem o worker, o webhook fica gravado e nao e entregue.

### 5. Esteira

O arquivo `.github/workflows/ci.yml` roda em todo push e pull request. O job `deliver` so executa depois dos gates:

- `npm test` e `npm run test:integration`
- build da imagem `delivery-lab:ci` sem publicar
- Trivy, interrompendo o job se houver vulnerabilidade critica com correcao disponivel
- gitleaks no historico do Git
- `terraform fmt` e `terraform validate`
- SonarCloud, apenas quando o segredo `SONAR_TOKEN` existe. Com o segredo, vulnerabilidade de severidade alta ou bloqueadora interrompe a entrega. Sem ele, o job registra a ausencia e o restante da esteira segue

`azure-pipelines.yml` repete essa sequencia no formato do Azure DevOps. Ele passa a executar quando o repositorio estiver ligado a um projeto com a extensao SonarCloud, a service connection `SonarCloud` e a variavel secreta `SONAR_TOKEN`.

No GitHub Actions, a analise fica desligada ate o token existir como segredo do repositorio:

```powershell
gh secret set SONAR_TOKEN --repo almeidasantosdev/delivery-lab
```

A organizacao e a chave do projeto estao em `sonar-project.properties`. No SonarCloud, importe o repositorio publico com essa mesma chave. Com o segredo configurado, o job `sonar` volta a analisar o codigo e a barrar vulnerabilidade alta ou bloqueadora.

### 6. Terraform

Cria uma VPC publica pequena, uma instancia Amazon Linux 2023 e um bucket S3 com versionamento e bloqueio de acesso publico. A porta 3000 abre somente para o CIDR que voce informar. Nao ha porta 22 aberta.

```powershell
cd terraform
Copy-Item terraform.tfvars.example terraform.tfvars
```

Edite `terraform.tfvars`: troque o nome do bucket por um nome unico e coloque seu IP em `allowed_cidr`, no formato `203.0.113.10/32`.

```powershell
terraform init
terraform plan
terraform apply
```

`t2.micro` pode ficar na camada gratuita de uma conta elegivel. Fora dessa condicao, a instancia gera cobranca. Ao terminar:

```powershell
terraform destroy
```

O estado local fica de fora do Git.

### 7. Parar

```powershell
docker compose down
```

`docker compose down -v` tambem apaga o volume do Postgres.

## Kubernetes

Os manifestos, o Kind e o HPA ficam em [delivery-lab-k8s](https://github.com/almeidasantosdev/delivery-lab-k8s). Este repositorio so constroi a imagem. A tag usada la continua `delivery-lab:local`, a partir de `docker/Dockerfile`. O `GET /health` da API continua na porta 3000 e consulta o Postgres.

Aquele repositorio ainda sobe um unico container, com a API e o worker no mesmo processo. Aqui o worker e outro comando, `node dist/worker-main.js`, e a entrega depende do RabbitMQ.

## Estrutura

```text
src/                 API NestJS, worker e testes Jest
sql/001_init.sql     schema, incluindo a tabela outbox
docker/Dockerfile    build em dois estagios, processo sem root
docker-compose.yml   API, worker, Postgres, RabbitMQ, Prometheus e Grafana
prometheus/          scrape da API e do worker a cada 5s
grafana/             datasource e dashboard versionados
.github/workflows/   esteira no GitHub Actions
azure-pipelines.yml  esboco da esteira no Azure DevOps
sonar-project.properties  projeto do SonarCloud
scripts/sonar-gate.sh     bloqueia vulnerabilidade alta
terraform/           VPC, EC2 e S3
docs/adr/            decisoes de esteira, fila e AWS
scripts/demo.ps1     chamada de exemplo
```

## Limites deste laboratorio

O provedor de pagamento e uma funcao que falha de proposito. A imagem construida na esteira nao e enviada a um registry. A EC2 do Terraform instala o Docker e para por ai. O RabbitMQ deste Compose nao publica a interface de administracao. O repositorio de Kubernetes ainda nao inclui o broker nem o processo do worker.
