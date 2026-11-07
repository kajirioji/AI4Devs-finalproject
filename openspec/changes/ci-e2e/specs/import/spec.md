## ADDED Requirements

### Requirement: Suite E2E en la CI
La CI SHALL ejecutar en cada pull request todos los escenarios de `e2e/features` contra el API y la web reales, sobre una base efímera recién migrada y sembrada justo antes del E2E, de modo que no dependa de lo que haya dejado otra suite. Un escenario que falle SHALL hacer fallar el check. Solo al fallar, SHALL publicar el informe de Playwright como artifact, sin traza ni vídeo y sin credenciales. La ejecución en local SHALL seguir igual.

#### Scenario: Pull request con el smoke en verde
- **GIVEN** un pull request que no toca la importación
- **WHEN** corre la CI
- **THEN** el job E2E ejecuta `Import smoke`, el escenario ve `Rows read 783`, `Matched 780` y `RAM-07 is not assigned yet` de `batch-clean`, el check queda en verde y no se publica ningún artifact de Playwright

#### Scenario: E2E independiente de la colección
- **GIVEN** que la colección Bruno se ejecutó antes en el mismo job y dejó `batch-clean` procesado y `RAM-07` asignado
- **WHEN** empieza el E2E
- **THEN** la base se ha vuelto a sembrar y el smoke ve `RAM-07 is not assigned yet`

#### Scenario: Un escenario falla
- **WHEN** un escenario de `e2e/features` falla en la CI
- **THEN** el check falla y el run tiene un artifact con el informe HTML y las capturas del fallo, sin archivos de traza ni de vídeo y sin el valor de `SEED_PASSWORD`

#### Scenario: La colección falla antes
- **WHEN** la colección Bruno falla en el mismo job
- **THEN** el E2E se ejecuta igualmente sobre la base sembrada otra vez, y el check falla

#### Scenario: Suite nueva sin tocar la CI
- **WHEN** se fusiona un `.feature` nuevo en `e2e/features` con sus pasos en `e2e/steps`
- **THEN** el job E2E lo ejecuta sin cambiar el workflow

#### Scenario: En local sin la aplicación
- **WHEN** se ejecuta `pnpm test:e2e` en local sin la aplicación o el API levantados
- **THEN** falla antes del primer paso con el mensaje que indica `pnpm db:up`, `pnpm db:seed` y `pnpm dev`, como hasta ahora
