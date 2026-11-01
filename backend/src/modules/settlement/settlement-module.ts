import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { PrismaAuditLogger } from '../../infrastructure/prisma-audit-logger.js'
import { PrismaMissingResolution } from '../validation/infrastructure/prisma-missing-resolution.js'
import { SettlementLifecycleService } from './application/settlement-lifecycle-service.js'
import { SettlementReadService } from './application/settlement-read-service.js'
import { SettlementService } from './application/settlement-service.js'
import { settlementLifecycleRoutes } from './http/settlement-lifecycle-routes.js'
import { settlementReadRoutes } from './http/settlement-read-routes.js'
import { settlementRoutes } from './http/settlement-routes.js'
import { ImportServicePrefilledFees } from './infrastructure/import-service-prefilled-fees.js'
import { PrismaSettlementLifecycleRepository } from './infrastructure/prisma-settlement-lifecycle-repository.js'
import { PrismaSettlementQueries } from './infrastructure/prisma-settlement-queries.js'
import { PrismaSettlementReader } from './infrastructure/prisma-settlement-reader.js'
import { PrismaSettlementRepository } from './infrastructure/prisma-settlement-repository.js'
import { PrismaSettlementSource } from './infrastructure/prisma-settlement-source.js'

export interface SettlementModuleOptions {
  /** Where the settlement routes are mounted, e.g. /api/v1. */
  routePrefix: string
  /** Injected service (tests); otherwise wired to Prisma and to the import service of the imports module. */
  service?: SettlementService
  /** Injected read service (tests); otherwise wired to Prisma (summary-exports). */
  reads?: SettlementReadService
  /** Injected lifecycle service (tests); otherwise wired to Prisma (settlement-lifecycle). */
  lifecycle?: SettlementLifecycleService
}

/** Composition root of the settlement module: source, repository, reader, services and routes. */
export const settlementModule = fp(
  async (app: FastifyInstance, options: SettlementModuleOptions) => {
    const reads =
      options.reads ??
      new SettlementReadService({
        queries: new PrismaSettlementQueries(app.prisma, { log: app.log }),
        reader: new PrismaSettlementReader(app.prisma, { log: app.log }),
        audit: new PrismaAuditLogger(app.prisma),
      })
    await app.register(settlementReadRoutes, { prefix: options.routePrefix, service: reads })
    const service =
      options.service ??
      new SettlementService({
        source: new PrismaSettlementSource(app.prisma),
        prefilled: new ImportServicePrefilledFees(app.importService),
        repository: new PrismaSettlementRepository(app.prisma, {
          missing: new PrismaMissingResolution(),
          log: app.log,
        }),
        reader: new PrismaSettlementReader(app.prisma, { log: app.log }),
      })
    await app.register(settlementRoutes, { prefix: options.routePrefix, service })
    const lifecycle =
      options.lifecycle ??
      new SettlementLifecycleService({
        queries: new PrismaSettlementQueries(app.prisma, { log: app.log }),
        repository: new PrismaSettlementLifecycleRepository(app.prisma, {
          missing: new PrismaMissingResolution(),
          log: app.log,
        }),
        reader: new PrismaSettlementReader(app.prisma, { log: app.log }),
      })
    await app.register(settlementLifecycleRoutes, { prefix: options.routePrefix, service: lifecycle })
  },
  { name: 'settlement-module', dependencies: ['prisma', 'auth', 'imports-module'] },
)
