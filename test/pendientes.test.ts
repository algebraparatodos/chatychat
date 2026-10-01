import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

import type { Credencial } from '../src/enviar'
import { barrer, programar, proximoPendiente } from '../src/pendientes'
import { baseDeCliente, fila, haceMinutos, interceptarRed, type Llamada } from './apoyo'

const CRED: Credencial = { flujo: 'instagram', token: 'token-de-prueba' }

let red: ReturnType<typeof interceptarRed>
let llamadas: Llamada[]
beforeEach(() => {
    red = interceptarRed()
    llamadas = red.llamadas
})
afterEach(() => red.restaurar())

function pendiente(db: ReturnType<typeof baseDeCliente>['db'], campos: Record<string, string | number | null>) {
    const nombres = Object.keys(campos)
    return Number(
        db
            .prepare(`INSERT INTO pendientes (${nombres.join(', ')}) VALUES (${nombres.map(() => '?').join(', ')})`)
            .run(...Object.values(campos)).lastInsertRowid,
    )
}

const estado = (db: ReturnType<typeof baseDeCliente>['db'], id: number) =>
    fila<{ estado: string; error: string | null }>(db, `SELECT estado, error FROM pendientes WHERE id = ?`, id)

test('un seguimiento al buzón de alguien cuya ventana se cerró caduca sin mandarse', async () => {
    const { sql, db } = baseDeCliente()
    db.prepare(`INSERT INTO eventos (tipo, de, creado) VALUES ('mensaje', 'persona-1', ?)`).run(haceMinutos(25 * 60))
    const id = pendiente(db, { destino: 'persona-1', texto: '¿Pudiste ver las macetas?', cuando: haceMinutos(1) })

    const r = await barrer(sql, CRED, 'luna-azul')

    assert.deepEqual(r, { enviados: 0, caducados: 1, fallos: 0 })
    assert.equal(llamadas.length, 0)
    assert.equal(estado(db, id)?.estado, 'caducado')
})

test('una respuesta privada apartada no depende de la ventana: sale contra el comentario', async () => {
    const { sql, db } = baseDeCliente()
    const id = pendiente(db, {
        destino: 'persona-2',
        texto: 'La maceta mediana sale 12 €.',
        tipo: 'comentario',
        comentario_id: 'c-9',
        cuando: haceMinutos(1),
    })

    const r = await barrer(sql, CRED, 'luna-azul')

    assert.equal(r.enviados, 1)
    assert.deepEqual(llamadas[0].cuerpo.recipient, { comment_id: 'c-9' })
    assert.equal(estado(db, id)?.estado, 'enviado')
})

test('un seguimiento de un flujo manda el texto de su caja si la ventana sigue abierta', async () => {
    const { sql, db } = baseDeCliente()
    db.prepare(`INSERT INTO eventos (tipo, de, creado) VALUES ('mensaje', 'persona-3', ?)`).run(haceMinutos(60))
    const auto = Number(db.prepare(`INSERT INTO automatizaciones (nombre) VALUES ('Seguimiento')`).run().lastInsertRowid)
    const nodo = Number(
        db.prepare(`INSERT INTO nodos (automatizacion_id, texto) VALUES (?, 'Seguimos teniendo stock 🌵')`).run(auto)
            .lastInsertRowid,
    )
    const id = pendiente(db, { destino: 'persona-3', nodo_id: nodo, cuando: haceMinutos(1) })

    await barrer(sql, CRED, 'luna-azul')

    assert.deepEqual(llamadas[0].cuerpo, { recipient: { id: 'persona-3' }, message: { text: 'Seguimos teniendo stock 🌵' } })
    assert.equal(estado(db, id)?.estado, 'enviado')
})

test('lo programado para más tarde no sale ahora, y marca la hora de la próxima alarma', async () => {
    const { sql, db } = baseDeCliente()
    const auto = Number(db.prepare(`INSERT INTO automatizaciones (nombre) VALUES ('Seguimiento')`).run().lastInsertRowid)
    const nodo = Number(
        db.prepare(`INSERT INTO nodos (automatizacion_id, texto) VALUES (?, 'Mañana te escribo')`).run(auto).lastInsertRowid,
    )
    programar(sql, 'persona-4', nodo, 23 * 60)

    assert.deepEqual(await barrer(sql, CRED, 'luna-azul'), { enviados: 0, caducados: 0, fallos: 0 })
    const proxima = proximoPendiente(sql)!
    const enHoras = (proxima - Date.now()) / 3_600_000
    assert.ok(enHoras > 22.9 && enHoras <= 23, `la alarma queda a ${enHoras} horas`)
})

test('sin sitio en el tope de la hora, el pendiente vuelve a la cola una hora más tarde', async () => {
    const { sql, db } = baseDeCliente()
    db.prepare(`INSERT INTO ritmo (hora, llamadas) VALUES (?, 700)`).run(new Date().toISOString().slice(0, 13).replace('T', ' '))
    const id = pendiente(db, { destino: 'p', texto: 'hola', tipo: 'comentario', comentario_id: 'c-1', cuando: haceMinutos(1) })

    await barrer(sql, CRED, 'luna-azul')

    assert.equal(llamadas.length, 0)
    assert.equal(estado(db, id)?.estado, 'espera')
    const enMinutos = (proximoPendiente(sql)! - Date.now()) / 60_000
    assert.ok(enMinutos > 55 && enMinutos <= 60)
})

test('sin pendientes no hay alarma', () => {
    const { sql } = baseDeCliente()
    assert.equal(proximoPendiente(sql), null)
})
