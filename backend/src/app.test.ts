import { describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import { loadEnv } from './config/env.js'
import type { PrismaClient } from './generated/prisma/client.js'

const env = loadEnv({ JWT_SECRET: 'unit-test-secret-not-a-real-one-00001', LOG_LEVEL: 'silent' })

function fakePrisma(queryRaw: () => Promise<unknown>) {
  return { $queryRaw: vi.fn(queryRaw), $disconnect: vi.fn(async () => {}) } as unknown as PrismaClient
}

describe('buildApp', () => {
  it('GET /api/v1/health answers 200 when the database responds', async () => {
    const app = await buildApp({ env, prisma: fakePrisma(async () => [{ ok: 1 }]) })

    const res = await app.inject({ method: 'GET', url: '/api/v1/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' })
    await app.close()
  })

  it('GET /api/v1/health answers 503 when the database query fails', async () => {
    const app = await buildApp({
      env,
      prisma: fakePrisma(async () => {
        throw new Error('connection refused')
      }),
    })

    const res = await app.inject({ method: 'GET', url: '/api/v1/health' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ status: 'degraded', db: 'error' })
    await app.close()
  })

  it('publishes an OpenAPI 3 document at /docs/json that lists the health route', async () => {
    const app = await buildApp({ env, prisma: fakePrisma(async () => [{ ok: 1 }]) })

    const res = await app.inject({ method: 'GET', url: '/docs/json' })

    expect(res.statusCode).toBe(200)
    const doc = res.json()
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc.paths).toHaveProperty('/api/v1/health')
    await app.close()
  })

  it('publishes the nine catalog routes with bearer security, the catalog tag and unassigned as true/false', async () => {
    const app = await buildApp({ env, prisma: fakePrisma(async () => [{ ok: 1 }]) })

    const res = await app.inject({ method: 'GET', url: '/docs/json' })

    expect(res.statusCode).toBe(200)
    const doc = res.json()
    const catalogPaths = [
      '/api/v1/merchants',
      '/api/v1/merchants/{merchantId}/providers',
      '/api/v1/providers/{providerId}',
      '/api/v1/providers/{providerId}/channels',
      '/api/v1/providers/{providerId}/accounts',
      '/api/v1/accounts/{accountId}',
      '/api/v1/accounts/{accountId}/channels',
      '/api/v1/channels',
      '/api/v1/channels/{channelId}/accounts',
    ]
    for (const path of catalogPaths) {
      const operation = doc.paths[path]?.get
      expect(operation, path).toBeDefined()
      expect(operation.tags, path).toEqual(['catalog'])
      expect(operation.security, path).toEqual([{ bearerAuth: [] }])
      expect(operation.responses, path).toHaveProperty('401')
    }
    const unassigned = doc.paths['/api/v1/channels'].get.parameters.find(
      (p: { name: string }) => p.name === 'unassigned',
    )
    expect(unassigned).toMatchObject({ in: 'query', required: false })
    // The wire format is a string: the document must say which two values are accepted.
    expect(unassigned.schema).toEqual({ type: 'string', enum: ['true', 'false'] })
    await app.close()
  })

  it('publishes the ten import routes with bearer security, the imports tag and multipart uploads documented', async () => {
    const app = await buildApp({ env, prisma: fakePrisma(async () => [{ ok: 1 }]) })

    const res = await app.inject({ method: 'GET', url: '/docs/json' })

    expect(res.statusCode).toBe(200)
    const doc = res.json()
    const operations: [string, 'get' | 'post' | 'put' | 'patch' | 'delete'][] = [
      ['/api/v1/accounts/{accountId}/imports', 'post'],
      ['/api/v1/accounts/{accountId}/imports', 'get'],
      ['/api/v1/imports/{importId}', 'get'],
      ['/api/v1/imports/{importId}/files', 'post'],
      ['/api/v1/imports/{importId}/files/{fileId}', 'delete'],
      ['/api/v1/imports/{importId}/mapping', 'put'],
      ['/api/v1/imports/{importId}/analyze', 'post'],
      ['/api/v1/imports/{importId}/rows', 'get'],
      ['/api/v1/imports/{importId}/rows/{sheetId}/{rowNo}', 'patch'],
      ['/api/v1/imports/{importId}/cancel', 'post'],
    ]
    for (const [path, method] of operations) {
      const operation = doc.paths[path]?.[method]
      expect(operation, `${method} ${path}`).toBeDefined()
      expect(operation.tags, path).toEqual(['imports'])
      expect(operation.security, path).toEqual([{ bearerAuth: [] }])
      expect(operation.responses, path).toHaveProperty('401')
    }
    for (const path of ['/api/v1/accounts/{accountId}/imports', '/api/v1/imports/{importId}/files']) {
      const post = doc.paths[path].post
      // The body is a multipart stream: documented as `files` parts, not schema-validated.
      const multipart = post.requestBody?.content?.['multipart/form-data']
      expect(multipart, path).toBeDefined()
      expect(multipart.schema.properties.files, path).toMatchObject({
        type: 'array',
        items: { type: 'string', format: 'binary' },
      })
      expect(post.responses, path).toHaveProperty('409')
      expect(post.responses, path).toHaveProperty('422')
    }
    const status = doc.paths['/api/v1/accounts/{accountId}/imports'].get.parameters.find(
      (p: { name: string }) => p.name === 'status',
    )
    expect(status).toMatchObject({ in: 'query', required: false })

    // import-analyze: JSON bodies on the confirmation and the resolution, 422 on analyze, 409 on every write.
    for (const [path, method] of [
      ['/api/v1/imports/{importId}/mapping', 'put'],
      ['/api/v1/imports/{importId}/rows/{sheetId}/{rowNo}', 'patch'],
    ] as const) {
      expect(doc.paths[path][method].requestBody?.content?.['application/json']?.schema, path).toBeDefined()
    }
    expect(doc.paths['/api/v1/imports/{importId}/analyze'].post.responses).toHaveProperty('422')
    for (const [path, method] of [
      ['/api/v1/imports/{importId}/mapping', 'put'],
      ['/api/v1/imports/{importId}/analyze', 'post'],
      ['/api/v1/imports/{importId}/rows/{sheetId}/{rowNo}', 'patch'],
      ['/api/v1/imports/{importId}/cancel', 'post'],
    ] as const) {
      expect(doc.paths[path][method].responses, path).toHaveProperty('409')
    }
    const pageSize = doc.paths['/api/v1/imports/{importId}/rows'].get.parameters.find(
      (p: { name: string }) => p.name === 'pageSize',
    )
    expect(pageSize).toMatchObject({ in: 'query', required: false })
    await app.close()
  })

  it('publishes the validation routes with bearer security and the validations tag (validation-runs)', async () => {
    const app = await buildApp({ env, prisma: fakePrisma(async () => [{ ok: 1 }]) })

    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json()

    const operations: [string, 'get' | 'post' | 'patch'][] = [
      ['/api/v1/imports/{importId}/validations', 'post'],
      ['/api/v1/imports/{importId}/validations', 'get'],
      ['/api/v1/imports/{importId}/validation-issues', 'get'],
      ['/api/v1/validation-issues/{issueId}', 'get'],
      ['/api/v1/validation-issues/{issueId}', 'patch'],
      ['/api/v1/conflict-occurrences/{occurrenceId}', 'patch'],
      ['/api/v1/imports/{importId}/review', 'post'],
    ]
    for (const [path, method] of operations) {
      const operation = doc.paths[path]?.[method]
      expect(operation, `${method} ${path}`).toBeDefined()
      expect(operation.tags, path).toEqual(['validations'])
      expect(operation.security, path).toEqual([{ bearerAuth: [] }])
      expect(operation.responses, path).toHaveProperty('401')
      expect(operation.responses, path).toHaveProperty('404')
    }
    expect(doc.paths['/api/v1/imports/{importId}/validations'].post.responses).toHaveProperty('409')
    await app.close()
  })

  it('publishes the settlement and fee routes with bearer security (settlement-process)', async () => {
    const app = await buildApp({ env, prisma: fakePrisma(async () => [{ ok: 1 }]) })

    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json()

    const operations: [string, 'get' | 'post', string][] = [
      ['/api/v1/imports/{importId}/settlements', 'post', 'settlements'],
      ['/api/v1/imports/{importId}/settlements/preview', 'post', 'settlements'],
      ['/api/v1/accounts/{accountId}/batch-number/next', 'get', 'settlements'],
      ['/api/v1/accounts/{accountId}/fees', 'get', 'fees'],
      ['/api/v1/fee-types', 'get', 'fees'],
    ]
    for (const [path, method, tag] of operations) {
      const operation = doc.paths[path]?.[method]
      expect(operation, `${method} ${path}`).toBeDefined()
      expect(operation.tags, path).toEqual([tag])
      expect(operation.security, path).toEqual([{ bearerAuth: [] }])
      expect(operation.responses, path).toHaveProperty('401')
    }
    expect(doc.paths['/api/v1/imports/{importId}/settlements'].post.responses).toHaveProperty('201')
    expect(doc.paths['/api/v1/imports/{importId}/settlements'].post.responses).toHaveProperty('409')
    await app.close()
  })

  it('publishes the four reads of an attempt, the export as text/csv with 403 and 500 (summary-exports)', async () => {
    const app = await buildApp({ env, prisma: fakePrisma(async () => [{ ok: 1 }]) })

    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json()

    for (const path of [
      '/api/v1/settlements/{batchId}',
      '/api/v1/settlements/{batchId}/transactions',
      '/api/v1/settlements/{batchId}/export',
      '/api/v1/imports/{importId}/settlements',
    ]) {
      const operation = doc.paths[path]?.get
      expect(operation, `get ${path}`).toBeDefined()
      expect(operation.tags, path).toEqual(['settlements'])
      expect(operation.security, path).toEqual([{ bearerAuth: [] }])
      expect(operation.responses, path).toHaveProperty('401')
      expect(operation.responses, path).toHaveProperty('404')
    }
    const exportResponses = doc.paths['/api/v1/settlements/{batchId}/export'].get.responses
    expect(Object.keys(exportResponses['200'].content)).toEqual(['text/csv'])
    expect(exportResponses).toHaveProperty('403')
    expect(exportResponses).toHaveProperty('500')
    await app.close()
  })

  it('publishes pay, unpay and undo of an attempt (settlement-lifecycle)', async () => {
    const app = await buildApp({ env, prisma: fakePrisma(async () => [{ ok: 1 }]) })

    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json()

    for (const action of ['pay', 'unpay', 'undo']) {
      const path = `/api/v1/settlements/{batchId}/${action}`
      const operation = doc.paths[path]?.post
      expect(operation, `post ${path}`).toBeDefined()
      expect(operation.tags, path).toEqual(['settlements'])
      expect(operation.security, path).toEqual([{ bearerAuth: [] }])
      for (const status of ['200', '400', '401', '403', '404', '409'])
        expect(operation.responses, path).toHaveProperty(status)
    }
    expect(doc.paths['/api/v1/settlements/{batchId}/pay'].post.requestBody).toBeUndefined()
    for (const action of ['unpay', 'undo'])
      expect(doc.paths[`/api/v1/settlements/{batchId}/${action}`].post.requestBody.required).toBe(true)
    await app.close()
  })

  it('does not disconnect an injected Prisma client on close', async () => {
    const prisma = fakePrisma(async () => [{ ok: 1 }])
    const app = await buildApp({ env, prisma })

    await app.close()

    expect(prisma.$disconnect).not.toHaveBeenCalled()
  })
})
