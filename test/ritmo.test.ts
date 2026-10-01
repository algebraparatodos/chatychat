import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cabenEstaHora, llamadasDeEstaHora, TOPE_POR_HORA } from '../src/ritmo'
import { baseDeCliente, filas } from './apoyo'

const estaHora = () => new Date().toISOString().slice(0, 13).replace('T', ' ')

test('el tope propio es 700, cincuenta por debajo de las 750 de Meta', () => {
    assert.equal(TOPE_POR_HORA, 700)
})

test('cada permiso concedido queda contado en la hora actual', () => {
    const { sql } = baseDeCliente()
    assert.equal(cabenEstaHora(sql, 2, 'luna-azul'), true)
    assert.equal(cabenEstaHora(sql, 1, 'luna-azul'), true)
    assert.equal(llamadasDeEstaHora(sql), 3)
})

test('se puede llegar justo al tope, pero no pasarlo', () => {
    const { sql, db } = baseDeCliente()
    db.prepare(`INSERT INTO ritmo (hora, llamadas) VALUES (?, 698)`).run(estaHora())

    assert.equal(cabenEstaHora(sql, 2, 'luna-azul'), true)
    assert.equal(llamadasDeEstaHora(sql), 700)
    assert.equal(cabenEstaHora(sql, 1, 'luna-azul'), false)
})

test('un permiso negado no gasta llamadas', () => {
    const { sql, db } = baseDeCliente()
    db.prepare(`INSERT INTO ritmo (hora, llamadas) VALUES (?, 699)`).run(estaHora())

    // Un comentario con aviso público son dos llamadas, y sólo queda una.
    assert.equal(cabenEstaHora(sql, 2, 'luna-azul'), false)
    assert.equal(llamadasDeEstaHora(sql), 699)
})

test('al empezar una hora nueva, las horas viejas se borran en el mismo viaje', () => {
    const { sql, db } = baseDeCliente()
    db.prepare(`INSERT INTO ritmo (hora, llamadas) VALUES ('2026-09-20 10', 400)`).run()

    cabenEstaHora(sql, 1, 'luna-azul')
    assert.deepEqual(
        filas<{ hora: string }>(db, `SELECT hora FROM ritmo`).map((f) => f.hora),
        [estaHora()],
    )
})

test('si no se puede contar, se manda igual: el tope de Meta sigue de red', () => {
    const rota = {
        exec() {
            throw new Error('la base no contesta')
        },
    } as unknown as SqlStorage
    assert.equal(cabenEstaHora(rota, 1, 'luna-azul'), true)
    assert.equal(llamadasDeEstaHora(rota), 0)
})
