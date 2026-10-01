/**
 * Las piezas de Cloudflare, sobre el SQLite que trae Node.
 *
 * El código de `src/` habla con dos clases de base: el SQLite de cada
 * Durable Object (`SqlStorage`, síncrono) y la base de control en D1
 * (asíncrona). Las dos son SQLite por debajo, así que aquí se imitan con
 * `node:sqlite` y **con el esquema de verdad**: el de `esquema-cliente.ts`
 * y el de `base/control.sql`. Una prueba que corriera contra un esquema
 * copiado a mano dejaría de probar nada el día que el original cambiara.
 */

import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import type { Env } from '../src/entorno'
import { PASOS } from '../src/esquema-cliente'

type Valor = SQLInputValue

/** La base de un cliente, como la ve su Durable Object. */
export function baseDeCliente(): { sql: SqlStorage; db: DatabaseSync } {
    const db = new DatabaseSync(':memory:')
    for (const paso of PASOS) db.exec(paso.sql)

    const sql = {
        exec(consulta: string, ...valores: Valor[]) {
            const sentencia = db.prepare(consulta)
            let filas: Record<string, unknown>[] = []
            let escritas = 0
            if (sentencia.columns().length > 0) {
                filas = sentencia.all(...valores) as Record<string, unknown>[]
                escritas = /^\s*(insert|update|delete)/i.test(consulta) ? filas.length : 0
            } else {
                escritas = Number(sentencia.run(...valores).changes)
            }
            return {
                [Symbol.iterator]: () => filas[Symbol.iterator](),
                toArray: () => filas,
                one: () => filas[0],
                rowsRead: filas.length,
                rowsWritten: escritas,
            }
        },
    }
    return { sql: sql as unknown as SqlStorage, db }
}

/** Una fila de la base del cliente, para mirar cómo quedó. */
export function fila<T>(db: DatabaseSync, consulta: string, ...valores: Valor[]): T | undefined {
    return db.prepare(consulta).get(...valores) as T | undefined
}

export function filas<T>(db: DatabaseSync, consulta: string, ...valores: Valor[]): T[] {
    return db.prepare(consulta).all(...valores) as T[]
}

/**
 * La base de control, como la ve el Worker en D1.
 *
 * `base/control.sql` crea la tabla de clientes de la primera versión;
 * las columnas que llegaron después las añade `herramientas/migrar-control.mjs`
 * en producción, y aquí se añaden las que usa el código que se prueba.
 */
export function baseDeControl(): { control: D1Database; db: DatabaseSync } {
    const db = new DatabaseSync(':memory:')
    db.exec(readFileSync(fileURLToPath(new URL('../base/control.sql', import.meta.url).href), 'utf8'))
    db.exec(`
        ALTER TABLE clientes ADD COLUMN flujo TEXT;
        ALTER TABLE clientes ADD COLUMN token_pagina TEXT;
    `)

    const preparar = (consulta: string) => {
        let valores: Valor[] = []
        const sentencia = {
            bind(...v: Valor[]) {
                valores = v
                return sentencia
            },
            async first<T>() {
                return (db.prepare(consulta).get(...valores) as T | undefined) ?? null
            },
            async all<T>() {
                return { results: db.prepare(consulta).all(...valores) as T[] }
            },
            async run() {
                return db.prepare(consulta).run(...valores)
            },
        }
        return sentencia
    }

    const control = {
        prepare: preparar,
        async batch(sentencias: { run(): Promise<unknown> }[]) {
            for (const s of sentencias) await s.run()
            return []
        },
    }
    return { control: control as unknown as D1Database, db }
}

/** Un `Env` con lo justo. Los secretos son de prueba. */
export function entorno(control: D1Database, extra: Partial<Env> = {}): Env {
    return {
        CONTROL: control,
        CLIENTES: undefined as unknown as Env['CLIENTES'],
        META_APP_SECRET: 'secreto-de-la-app',
        META_VERIFY_TOKEN: 'token-de-verificacion',
        ...extra,
    }
}

/** Una llamada que el código intentó hacer a la red. */
export type Llamada = { url: string; cuerpo: any }

/**
 * Sustituye `fetch` y apunta lo que se habría mandado a Meta.
 *
 * Contesta 200 a todo, o lo que diga `responder`. Ninguna prueba sale a
 * la red: si el código llamara a un sitio que no se espera, queda aquí
 * apuntado y la prueba lo ve.
 */
export function interceptarRed(
    responder: (url: string) => Response = () => new Response('{"ok":true}', { status: 200 }),
): { llamadas: Llamada[]; restaurar: () => void } {
    const original = globalThis.fetch
    const llamadas: Llamada[] = []
    globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
        const url = String(entrada)
        llamadas.push({ url, cuerpo: init?.body ? JSON.parse(String(init.body)) : null })
        return responder(url)
    }) as typeof fetch
    return { llamadas, restaurar: () => (globalThis.fetch = original) }
}

/** 'YYYY-MM-DD HH:MM:SS' en UTC, como guarda las fechas SQLite. */
export function haceMinutos(minutos: number): string {
    return new Date(Date.now() - minutos * 60_000).toISOString().slice(0, 19).replace('T', ' ')
}
