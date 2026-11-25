# Um servico so neste laboratorio

Decisao original: a API e o worker viviam no mesmo processo. O worker lia `delivery_jobs` com `FOR UPDATE SKIP LOCKED`.

Essa decisao foi substituida. A separacao atual esta em `004-nestjs-rabbitmq.md`: a API fica em NestJS e o worker consome o RabbitMQ. Os manifestos do cluster continuam no repositorio irmao `delivery-lab-k8s`.
