variable "aws_region" {
  description = "Regiao AWS do laboratorio."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "Tipo da instancia. t2.micro entra na camada gratuita de contas elegiveis."
  type        = string
  default     = "t2.micro"
}

variable "allowed_cidr" {
  description = "CIDR autorizado a acessar a API na porta 3000. Use o seu IP publico com /32."
  type        = string
}

variable "artifact_bucket_name" {
  description = "Nome globalmente unico do bucket de artefatos."
  type        = string
}
