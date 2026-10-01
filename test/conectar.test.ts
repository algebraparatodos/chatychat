/**
 * El `state` del OAuth: es lo que dice de qué cliente es la cuenta que
 * vuelve de Instagram, así que va firmado.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { firmarEstado, leerEstado } from '../src/conectar'
import { baseDeControl, entorno } from './apoyo'

const env = entorno(baseDeControl().control)

test('un state firmado aquí se lee y devuelve la clave del cliente', async () => {
    const estado = await firmarEstado('lunaazul', env)
    assert.match(estado, /^lunaazul\.[0-9a-f]{64}$/)
    assert.equal(await leerEstado(estado, env), 'lunaazul')
})

test('cambiar la clave para colgarle la cuenta a otro cliente invalida la firma', async () => {
    const estado = await firmarEstado('lunaazul', env)
    const firma = estado.slice(estado.indexOf('.') + 1)
    assert.equal(await leerEstado(`ruedaroja.${firma}`, env), null)
})

test('un state firmado con otro secreto no vale', async () => {
    const ajeno = await firmarEstado('lunaazul', { ...env, META_APP_SECRET: 'otro-secreto' })
    assert.equal(await leerEstado(ajeno, env), null)
})

test('un state sin firma, o con la firma cortada, no vale', async () => {
    const estado = await firmarEstado('lunaazul', env)
    assert.equal(await leerEstado('lunaazul', env), null)
    assert.equal(await leerEstado('.abc', env), null)
    assert.equal(await leerEstado(estado.slice(0, -2), env), null)
})
