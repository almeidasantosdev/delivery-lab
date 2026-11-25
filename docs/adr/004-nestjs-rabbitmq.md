# API em NestJS e entrega pelo RabbitMQ

A API HTTP passou para NestJS. O webhook continua gravando o evento e o job na mesma transacao do Postgres, agora com uma linha na tabela `outbox`.

O worker e outro processo. Ele publica o outbox no RabbitMQ e consome a fila `delivery.jobs`. Falha simulada volta por uma fila com TTL. Na quinta falha a mensagem vai para `delivery.jobs.dlq`.

O cluster local continua no repositorio `delivery-lab-k8s`. Este repositorio nao duplica os manifestos.
