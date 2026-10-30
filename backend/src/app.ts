import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import type { Env } from './config/env.js'
import type { PrismaClient } from './generated/prisma/client.js'
import type { AuthService } from './modules/auth/application/auth-service.js'
import { authModule } from './modules/auth/auth-module.js'
import type { CatalogService } from './modules/catalog/application/catalog-service.js'
import { catalogModule } from './modules/catalog/catalog-module.js'
import type { FeeReadService } from './modules/fees/application/fee-read-service.js'
import { feesModule } from './modules/fees/fees-module.js'
import type { ImportService } from './modules/imports/application/import-service.js'
import type { FileStore } from './modules/imports/application/ports.js'
import { importsModule } from './modules/imports/imports-module.js'
import type { SettlementLifecycleService } from './modules/settlement/application/settlement-lifecycle-service.js'
import type { SettlementReadService } from './modules/settlement/application/settlement-read-service.js'
import type { SettlementService } from './modules/settlement/application/settlement-service.js'
import { settlementModule } from './modules/settlement/settlement-module.js'
import type { ValidationService } from './modules/validation/application/validation-service.js'
import { validationModule } from './modules/validation/validation-module.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { prismaPlugin } from './plugins/prisma.js'
import { healthRoutes } from './routes/health.js'

export const API_PREFIX = '/api/v1'

/** Documentation-only body of the multipart upload routes (README §4.2): 1 to 10 `.xlsx` parts named `files`. */
const MULTIPART_FILES_BODY = {
  type: 'object',
  required: ['files'],
  properties: {
    files: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: { type: 'string', format: 'binary' },
      description: 'One or more .xlsx files of at most 20 MiB each',
    },
  },
}

export interface BuildAppOptions {
  env: Env
  /** Injected Prisma client (tests); otherwise one is created from env and closed with the app. */
  prisma?: PrismaClient
  /** Injected auth service (tests); otherwise built from Prisma, Argon2 and @fastify/jwt. */
  authService?: AuthService
  /** Injected catalog service (tests); otherwise built on the Prisma catalog repository. */
  catalogService?: CatalogService
  /** Injected import service and file store (tests); otherwise built on Prisma, the disk store and the xlsx reader. */
  imports?: { service: ImportService; files: FileStore }
  /** Injected validation service (tests); otherwise built on the Prisma sources and run repository. */
  validation?: { service: ValidationService }
  /** Injected fee read service (tests); otherwise built on the Prisma fee repository. */
  fees?: { service: FeeReadService }
  /** Injected settlement services (tests); otherwise built on Prisma and the import service. */
  settlement?: { service: SettlementService; reads?: SettlementReadService; lifecycle?: SettlementLifecycleService }
  /** Log destination (tests capture logs through it); defaults to stdout. */
  logStream?: { write(line: string): void }
}

/** Builds the Fastify application without listening (README §4 conventions). */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { env } = options
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: ['req.headers.authorization', '*.password', '*.accessToken', '*.refreshToken', '*.passwordHash'],
        censor: '[redacted]',
      },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(errorHandlerPlugin)
  await app.register(prismaPlugin, { env, client: options.prisma })

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'Recon Tool API', version: '0.1.0' },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: (input) => {
      const result = jsonSchemaTransform(input)
      const schema = result.schema as { response?: Record<string, unknown>; consumes?: string[]; body?: unknown }
      // A 204 has no body by definition: `type: 'null'` makes @fastify/swagger document it without content.
      if (schema.response?.['204']) schema.response['204'] = { type: 'null', description: 'No content' }
      // A multipart upload is consumed as a stream, not validated by a body schema: document the `files` parts (README §4.2).
      const consumes = (input.schema as { consumes?: string[] } | undefined)?.consumes
      if (consumes?.includes('multipart/form-data') && schema.body === undefined) {
        schema.consumes = consumes
        schema.body = MULTIPART_FILES_BODY
      }
      return result
    },
  })
  await app.register(swaggerUi, { routePrefix: '/docs' })

  await app.register(authModule, {
    jwtSecret: env.JWT_SECRET,
    routePrefix: `${API_PREFIX}/auth`,
    service: options.authService,
  })
  await app.register(catalogModule, { routePrefix: API_PREFIX, service: options.catalogService })
  await app.register(importsModule, {
    routePrefix: API_PREFIX,
    uploadDir: env.UPLOAD_DIR,
    service: options.imports?.service,
    files: options.imports?.files,
  })
  await app.register(validationModule, { routePrefix: API_PREFIX, service: options.validation?.service })
  await app.register(feesModule, { routePrefix: API_PREFIX, service: options.fees?.service })
  await app.register(settlementModule, {
    routePrefix: API_PREFIX,
    service: options.settlement?.service,
    reads: options.settlement?.reads,
    lifecycle: options.settlement?.lifecycle,
  })
  await app.register(healthRoutes, { prefix: API_PREFIX })

  return app
}
