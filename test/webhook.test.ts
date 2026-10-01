/**
 * La entrada del Worker: la firma de Meta y el reparto por cliente.
 */

import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import worker from '../src/index'
import type { Env } from '../src/entorno'
import { baseDeControl, entorno } from './apoyo'

const SECRETO_INSTAGRAM = 'secreto-de-la-app-de-instagram'

/** Dos clientes, uno por cada flujo de Meta, y un objeto falso que apunta a quién llega qué. */
function plataforma() {
    const { control, db } = baseDeControl()
    db.exec(`
        INSERT INTO clientes (clave, nombre, cuenta_ig, token, estado, base_id)
        VALUES ('lunaazul', 'Vivero Luna Azul', 'cuenta-luna', 'token-de-instagram', 'alta', 'local');
        INSERT INTO clientes (clave, nombre, cuenta_ig, token, estado, base_id, flujo, token_pagina, pagina_fb)
        VALUES ('ruedaroja', 'Bicis Rueda Roja', 'cuenta-rueda', '', 'alta', 'local', 'facebook', 'token-de-pagina', 'pagina-rueda');
        INSERT INTO clientes (clave, nombre, cuenta_ig, token, estado, base_id)
        VALUES ('pausado', 'Negocio en pausa', 'cuenta-pausa', 'token', 'pausa', 'local');
    `)

    const recibidos: { objeto: string; cuenta: string | undefined; cred: unknown }[] = []
    const CLIENTES = {
        idFromName: (nombre: string) => nombre,
        get: (id: string) => ({
            recibir: async (entrada: { id?: string }, quien: { cred: unknown }) => {
                recibidos.push({ objeto: id, cuenta: entrada.id, cred: quien.cred })
            },
        }),
    } as unknown as Env['CLIENTES']

    const env = entorno(control, { CLIENTES, META_APP_SECRET_INSTAGRAM: SECRETO_INSTAGRAM })
    return { env, recibidos }
}

function contexto() {
    const pendientes: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => pendientes.push(p), passThroughOnException() {} }
    return { ctx: ctx as unknown as ExecutionContext, terminar: () => Promise.all(pendientes) }
}

function post(cuerpo: string, firma?: string): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (firma) headers['x-hub-signature-256'] = firma
    return new Request('https://webhook.example.com/webhook', { method: 'POST', body: cuerpo, headers })
}

const firmar = (cuerpo: string, secreto: string) => `sha256=${createHmac('sha256', secreto).update(cuerpo).digest('hex')}`

const lote = JSON.stringify({
    object: 'instagram',
    entry: [
        { id: 'cuenta-luna', changes: [] },
        { id: 'cuenta-rueda', changes: [] },
        { id: 'cuenta-pausa', changes: [] },
        { id: 'cuenta-de-nadie', changes: [] },
    ],
})

test('el apretón de manos de Meta devuelve el desafío tal cual, sólo con el token bueno', async () => {
    const { env } = plataforma()
    const { ctx } = contexto()
    const url = (token: string) =>
        `https://webhook.example.com/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`

    const bueno = await worker.fetch(new Request(url('token-de-verificacion')), env, ctx)
    const malo = await worker.fetch(new Request(url('otro')), env, ctx)

    assert.equal(bueno.status, 200)
    assert.equal(await bueno.text(), '1158201444')
    assert.equal(malo.status, 403)
})

test('un evento sin firma, o firmado con otro secreto, se rechaza con un 403', async () => {
    const { env, recibidos } = plataforma()
    const { ctx, terminar } = contexto()

    assert.equal((await worker.fetch(post(lote), env, ctx)).status, 403)
    assert.equal((await worker.fetch(post(lote, firmar(lote, 'secreto-ajeno')), env, ctx)).status, 403)
    assert.equal((await worker.fetch(post(lote, 'sha256=zz'), env, ctx)).status, 403)
    await terminar()
    assert.equal(recibidos.length, 0)
})

test('la firma vale con el secreto de cualquiera de nuestras apps', async () => {
    const { env } = plataforma()
    const { ctx, terminar } = contexto()
    assert.equal((await worker.fetch(post(lote, firmar(lote, env.META_APP_SECRET)), env, ctx)).status, 200)
    assert.equal((await worker.fetch(post(lote, firmar(lote, SECRETO_INSTAGRAM)), env, ctx)).status, 200)
    await terminar()
})

test('cada entrada va al objeto de su cliente, con la credencial de su flujo; las demás se descartan', async () => {
    const { env, recibidos } = plataforma()
    const { ctx, terminar } = contexto()

    await worker.fetch(post(lote, firmar(lote, env.META_APP_SECRET)), env, ctx)
    await terminar()

    assert.deepEqual(recibidos, [
        { objeto: 'lunaazul', cuenta: 'cuenta-luna', cred: { flujo: 'instagram', token: 'token-de-instagram' } },
        { objeto: 'ruedaroja', cuenta: 'cuenta-rueda', cred: { flujo: 'facebook', token: 'token-de-pagina', pagina: 'pagina-rueda' } },
    ])
})

test('un cuerpo bien firmado que no es JSON se contesta con 200: reintentarlo no lo arregla', async () => {
    const { env } = plataforma()
    const { ctx } = contexto()
    const roto = '{esto no es json'
    assert.equal((await worker.fetch(post(roto, firmar(roto, env.META_APP_SECRET)), env, ctx)).status, 200)
})
