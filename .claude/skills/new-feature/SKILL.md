---
name: new-feature
description: Arranca una feature de Recon Tool 2.0 de la forma acordada — change de OpenSpec, rama, tests primero, PR. Usar cuando K pida "empezar", "arrancar" o "implementar" una feature, historia o ticket.
---

# Nueva feature

Sigue este orden sin saltarte pasos. Si algo no está claro en el README, pregunta antes de
escribir código; no inventes reglas de negocio.

1. **Localiza la regla.** Lee en `README.md` la sección que gobierna la feature (1.2 reglas de
   negocio, 3.2 entidad, 3.3 validación, 4 endpoint, 5 historia, 6 ticket) y la spec viva en
   `openspec/specs/<modulo>/spec.md`. Resume en 5 líneas qué cambia y qué no.
2. **Proposal.** Ejecuta `/opsx:propose <nombre-kebab>`. El proposal debe citar las secciones
   del README que implementa, listar los archivos que tocará y los `expected.json` de
   `data/samples/` que servirán de oráculo. Para y espera la aprobación humana.
3. **Rama.** `git checkout -b feat/<modulo>-<tema>` desde `feature/entrega-3-MVP`.
4. **Tests primero.** Escribe los tests de dominio (Vitest) que fallan. Ejecútalos y confirma
   que fallan por la razón correcta. Solo entonces `/opsx:apply`.
5. **Implementa** en el módulo hexagonal correspondiente: dominio puro sin Prisma; casos de uso
   con puertos; adaptadores Prisma/Fastify fuera del dominio. Dinero como string decimal en la
   API y `Decimal` en el dominio.
6. **Verifica.** `pnpm lint && pnpm typecheck && pnpm test`. Luego `/opsx:verify` y resuelve
   los warnings (corrigiendo código o actualizando la spec, nunca ignorándolos).
7. **PR.** Commit convencional, `gh pr create` hacia `feature/entrega-3-MVP` con la plantilla
   del repo. No hagas merge: lo hace K tras el review.
8. **Archiva** con `/opsx:archive` solo después del merge.
