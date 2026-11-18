output "instance_public_ip" {
  description = "IP publico da instancia. A API so escuta depois que a imagem for colocada na maquina."
  value       = aws_instance.api.public_ip
}

output "artifact_bucket" {
  description = "Bucket privado para artefatos do laboratorio."
  value       = aws_s3_bucket.artifacts.bucket
}

output "vpc_id" {
  value = aws_vpc.lab.id
}
