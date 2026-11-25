$ErrorActionPreference = "Stop"
$base = "http://localhost:3000"

Write-Host "Conferindo a API em $base"
Invoke-RestMethod "$base/health" | ConvertTo-Json

$key = "evt_" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$body = @{
  idempotency_key    = $key
  event_type         = "payment.confirmed"
  fail_until_attempt = 1
  payload            = @{ amount_cents = 1500 }
} | ConvertTo-Json

Write-Host "Primeiro envio de $key"
$created = Invoke-RestMethod "$base/webhooks/payments" -Method Post -ContentType "application/json" -Body $body
$created | ConvertTo-Json

Write-Host "Mesma chave de novo"
$duplicate = Invoke-RestMethod "$base/webhooks/payments" -Method Post -ContentType "application/json" -Body $body
$duplicate | ConvertTo-Json

Write-Host "Aguardando o worker retentar e entregar"
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Seconds 1
  $view = Invoke-RestMethod "$base/webhooks/$key"
} while ($view.status -ne "delivered" -and (Get-Date) -lt $deadline)

$view | ConvertTo-Json -Depth 5
if ($view.status -ne "delivered") {
  throw "A entrega nao concluiu a tempo. Veja os logs com: docker compose logs worker"
}

Write-Host "Metricas em $base/metrics"
Write-Host "Grafana em http://localhost:3001 (admin / admin)"
Write-Host "Prometheus em http://localhost:9090"
