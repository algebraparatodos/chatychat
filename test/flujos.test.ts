import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cajaDelBoton, cajaPorId, primeraCaja } from '../src/flujos'
import { baseDeCliente } from './apoyo'

/**
 * Un flujo del vivero «Luna Azul»:
 *
 *   bienvenida ──[Precios]──▶ precios ──siguiente──▶ despedida
 *              ──[Catálogo]─▶ (enlace)
 */
function flujo() {
    const { sql, db } = baseDeCliente()
    const id = (r: { lastInsertRowid: number | bigint }) => Number(r.lastInsertRowid)

    const auto = id(
        db.prepare(`INSERT INTO automatizaciones (nombre, activa, respuesta) VALUES ('Info', 1, 'Te paso la info')`).run(),
    )
    const caja = (texto: string | null, orden: number, siguiente: number | null = null) =>
        id(
            db
                .prepare(`INSERT INTO nodos (automatizacion_id, texto, orden, siguiente) VALUES (?, ?, ?, ?)`)
                .run(auto, texto, orden, siguiente),
        )
    const boton = (nodo: number, texto: string, tipo: string, destino: number | null, url: string | null, orden = 0) =>
        id(
            db
                .prepare(`INSERT INTO botones (nodo_id, texto, tipo, destino, url, orden) VALUES (?, ?, ?, ?, ?, ?)`)
                .run(nodo, texto, tipo, destino, url, orden),
        )

    const despedida = caja('¡Gracias por escribirnos!', 2)
    const precios = caja('  La maceta mediana sale 12 €.  ', 1, despedida)
    const bienvenida = caja('Hola! ¿Qué te interesa?', 0)
    const bPrecios = boton(bienvenida, 'Precios', 'ir', precios, null, 0)
    boton(bienvenida, 'Catálogo', 'enlace', null, 'https://example.com/catalogo', 1)

    return { sql, db, auto, bienvenida, precios, despedida, bPrecios, caja, boton }
}

test('la primera caja es la de menor orden, con sus botones de los dos tipos', () => {
    const f = flujo()
    const caja = primeraCaja(f.sql, f.auto, 'luna-azul')
    assert.equal(caja?.id, f.bienvenida)
    assert.deepEqual(caja?.botones, [
        { titulo: 'Precios', payload: `b${f.bPrecios}` },
        { titulo: 'Catálogo', url: 'https://example.com/catalogo' },
    ])
})

test('el botón lleva su propio id y no su texto, para que editarlo no rompa conversaciones', () => {
    const f = flujo()
    f.db.prepare(`UPDATE botones SET texto = 'Ver precios' WHERE id = ?`).run(f.bPrecios)
    const destino = cajaDelBoton(f.sql, `b${f.bPrecios}`, 'luna-azul')
    assert.equal(destino?.id, f.precios)
    assert.equal(destino?.texto, 'La maceta mediana sale 12 €.')
    assert.equal(destino?.siguiente, f.despedida)
})

test('un payload que no es de un botón nuestro no lleva a ningún sitio', () => {
    const f = flujo()
    assert.equal(cajaDelBoton(f.sql, 'b0', 'luna-azul'), null)
    assert.equal(cajaDelBoton(f.sql, 'hola', 'luna-azul'), null)
    assert.equal(cajaDelBoton(f.sql, 'b999', 'luna-azul'), null)
})

test('cajaPorId sigue la cadena de `siguiente`', () => {
    const f = flujo()
    assert.equal(cajaPorId(f.sql, f.despedida, 'luna-azul')?.texto, '¡Gracias por escribirnos!')
})

test('un botón sin destino o un enlace sin dirección se quitan, y el resto del mensaje sale', () => {
    const f = flujo()
    const caja = f.caja('Elegí una opción', -1)
    f.boton(caja, 'Roto', 'ir', null, null, 0)
    f.boton(caja, 'Sin web', 'enlace', null, null, 1)
    f.boton(caja, 'Precios', 'ir', f.precios, null, 2)

    const primera = primeraCaja(f.sql, f.auto, 'luna-azul')
    assert.equal(primera?.id, caja)
    assert.deepEqual(primera?.botones.map((b) => b.titulo), ['Precios'])
})

test('nunca salen más de tres botones', () => {
    const f = flujo()
    const caja = f.caja('Elegí', -1)
    for (let i = 0; i < 5; i++) f.boton(caja, `Opción ${i}`, 'ir', f.precios, null, i)
    assert.equal(primeraCaja(f.sql, f.auto, 'luna-azul')?.botones.length, 3)
})

test('una automatización sin cajas, o con la primera vacía, no es un flujo', () => {
    const { sql, db } = baseDeCliente()
    const suelta = Number(
        db.prepare(`INSERT INTO automatizaciones (nombre, activa, respuesta) VALUES ('Suelta', 1, 'Hola')`).run()
            .lastInsertRowid,
    )
    assert.equal(primeraCaja(sql, suelta, 'luna-azul'), null)

    db.prepare(`INSERT INTO nodos (automatizacion_id, texto, orden) VALUES (?, '   ', 0)`).run(suelta)
    assert.equal(primeraCaja(sql, suelta, 'luna-azul'), null)
})
