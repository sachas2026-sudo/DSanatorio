import { ZodError, type ZodType } from 'zod'

function isZodSchema(schema: unknown): schema is ZodType {
  return typeof schema === 'object' && schema !== null && 'safeParse' in schema && typeof schema.safeParse === 'function' && 'parse' in schema && typeof schema.parse === 'function'
}

export function zodValidatorCompiler({ schema }: { schema: unknown }) {
  if (!isZodSchema(schema)) throw new Error('El validador de Fastify solo admite esquemas Zod')
  return (data: unknown) => {
    const result = schema.safeParse(data)
    if (result.success) return { value: result.data }
    const error = Object.assign(new Error('Solicitud inválida'), { statusCode: 400, validation: (result.error as ZodError).issues })
    return { error }
  }
}

export function zodSerializerCompiler({ schema }: { schema: unknown }) {
  if (!isZodSchema(schema)) throw new Error('El serializador de Fastify solo admite esquemas Zod')
  return (data: unknown) => JSON.stringify(schema.parse(data))
}