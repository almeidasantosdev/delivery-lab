# GitHub Actions como esteira do laboratorio

A entrega deste repositorio passa pelo GitHub Actions porque o codigo ja nasce no GitHub e a esteira fica no mesmo lugar do pull request. O workflow `ci.yml` testa a API, constroi a imagem, bloqueia vulnerabilidade critica conhecida e valida o Terraform.

Jenkins ou GitLab CI resolveriam o mesmo fluxo. Eles pediriam outro servidor so para demonstrar uma esteira que o GitHub ja executa de graca em repositorio publico. A escolha fica revisavel no dia em que um time exigir a ferramenta da empresa.
