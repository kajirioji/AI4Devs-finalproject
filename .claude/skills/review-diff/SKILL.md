---
name: review-diff
description: Revisa un diff o PR de Recon Tool 2.0 con los cinco focos acordados (README §7) y el vocabulario fijo del proyecto. Usar antes de abrir o aprobar un PR.
---

# Revisión de diff

Revisa `git diff feature/entrega-3-MVP...HEAD` (o el PR indicado) y responde con hallazgos
concretos (archivo:línea → problema → propuesta), ordenados por severidad. Sin elogios.

Cinco focos, en este orden:

1. **Fidelidad al README.** ¿Cada regla implementada existe en §1.2/§3.3/§4? ¿Se usa el
   vocabulario fijo (`cycle` E/I/R, estados, `matchResult`, códigos de validación)? Señala toda
   regla inventada o renombrada.
2. **Dinero y fechas.** Nada de `number` para importes en dominio ni API; `DECIMAL(19,4)` en BD;
   vigencias de fees con `NULL` como −∞/+∞; fechas en UTC; redondeo explícito.
3. **Pruebas.** ¿Hay test por regla? ¿Usa `expected.json` como oráculo? ¿Falla si se rompe la
   regla? ¿Hay "test theater" (tests que solo repiten la implementación)?
4. **Seguridad y datos.** Sin secretos ni identificadores reales; permisos por `permissionCode`;
   `merchantScope` aplicado en toda consulta; entradas validadas con Zod; SQL crudo
   parametrizado; auditoría en las acciones que el README lista.
5. **Arquitectura.** Dominio sin Prisma/Fastify; casos de uso con puertos; migraciones solo
   dentro de un change de OpenSpec; sin lógica de negocio en handlers HTTP ni en componentes React.

Termina con una línea: `APROBAR` / `APROBAR CON CAMBIOS MENORES` / `NO APROBAR`, y el motivo.
