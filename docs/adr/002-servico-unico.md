# Um servico so neste laboratorio

A API e o worker vivem no mesmo processo. O worker consulta a tabela `delivery_jobs` com `FOR UPDATE SKIP LOCKED`, entao uma segunda instancia nao pega o mesmo job. Isso mostra o mecanismo de concorrencia sem operar um cluster.

Kubernetes entra num repositorio seguinte, quando esta imagem ja tiver pipeline verde. Subir orquestracao agora aumentaria o laboratorio sem mudar a pergunta que este repo responde: o codigo testa, empacota, sobe e aparece no Grafana.
