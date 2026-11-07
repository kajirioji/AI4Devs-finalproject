## ADDED Requirements

### Requirement: Colección en la CI
La CI SHALL ejecutar en cada pull request la colección completa (`pnpm test:api`) contra el API real, sobre una base efímera recién migrada y sembrada. Las credenciales SHALL llegar como variables del job, con valores de usar y tirar, sin escribir `api-collection/.env`. Una petición que falle SHALL hacer fallar el check. La ejecución en local SHALL seguir igual.

#### Scenario: Pull request con la colección en verde
- **WHEN** corre la CI de un pull request
- **THEN** el job E2E ejecuta `00-auth`, `10-smoke` y `20-flows`, todas las peticiones pasan y el check queda en verde

#### Scenario: Un endpoint roto
- **GIVEN** un pull request que cambia el código de error de un endpoint sin actualizar su petición negativa
- **WHEN** corre la CI
- **THEN** la petición falla con el código esperado y el recibido en el log del job, y el check falla

#### Scenario: Flujos que ensucian la base
- **WHEN** la colección termina en la CI
- **THEN** la base efímera se vuelve a sembrar antes del E2E, y lo que dejan `settlements/batch-clean`, `fees`, `accounts` y `matching` no llega a la siguiente suite

#### Scenario: En local
- **WHEN** se ejecuta `pnpm test:api` en local con `api-collection/.env` y `pnpm dev` levantado
- **THEN** se comporta como hasta ahora
