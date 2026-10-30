import { ErrorResponse, ReasonRequest, SettlementView } from '@recon/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { scopeOf } from '../../catalog/domain/scope.js'
import type { SettlementLifecycleService } from '../application/settlement-lifecycle-service.js'

export interface SettlementLifecycleRoutesOptions {
  service: SettlementLifecycleService
}

const BatchParams = z.object({ batchId: z.uuid() })
const settlements = { tags: ['settlements'], security: [{ bearerAuth: [] }] }
const errors = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse }

/** README §4.4, rows Settlement (settlement-lifecycle design D2, D7, D8). Mounted under /api/v1. */
export const settlementLifecycleRoutes: FastifyPluginAsyncZod<SettlementLifecycleRoutesOptions> = async (
  app,
  { service },
) => {
  app.post(
    '/settlements/:batchId/pay',
    {
      preHandler: app.requirePermission('payment.process'),
      schema: {
        ...settlements,
        summary: 'Mark a processed attempt as paid: its movements become Settled',
        description:
          'Without a body. 409 settlement_not_processed from paid or undone (details.status); settlement_busy.',
        params: BatchParams,
        response: { 200: SettlementView, ...errors },
      },
    },
    async (request) => service.pay(scopeOf(request.auth), request.auth.userId, request.params.batchId),
  )

  app.post(
    '/settlements/:batchId/unpay',
    {
      preHandler: app.requirePermission('payment.process'),
      schema: {
        ...settlements,
        summary: 'Remove the payment of a paid attempt, with a reason; it does not revert the Back-Office',
        description:
          '400 validation_error without a reason. 409 settlement_not_paid from processed or undone (details.status); ' +
          'settlement_busy.',
        params: BatchParams,
        body: ReasonRequest,
        response: { 200: SettlementView, ...errors },
      },
    },
    async (request) =>
      service.unpay(scopeOf(request.auth), request.auth.userId, request.params.batchId, request.body.reason),
  )
}
