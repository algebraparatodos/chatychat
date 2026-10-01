import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cerrarReserva, guardarMensaje, reservarComentario, ultimoMensajeDe } from '../src/eventos'
import { baseDeCliente, fila, haceMinutos } from './apoyo'

const comentario = { de: 'persona-1', usuario: 'ana.plantas', texto: 'info', comentarioId: 'c-1', mediaId: 'media-1' }

test('el mismo comentario dos veces: sólo la primera copia se atiende', () => {
    const { sql } = baseDeCliente()
    const primera = reservarComentario(sql, comentario)
    const segunda = reservarComentario(sql, comentario)
    assert.equal(primera.nuestro, true)
    assert.ok(primera.id > 0)
    assert.deepEqual(segunda, { nuestro: false, id: 0 })
})

test('la copia duplicada no vuelve a contar a la persona como contacto', () => {
    const { sql, db } = baseDeCliente()
    reservarComentario(sql, comentario)
    reservarComentario(sql, comentario)
    assert.equal(fila<{ veces: number }>(db, `SELECT veces FROM contactos WHERE de = 'persona-1'`)?.veces, 1)
})

test('si la base falla al reservar, no se contesta', () => {
    const rota = {
        exec() {
            throw new Error('disco lleno')
        },
    } as unknown as SqlStorage
    assert.deepEqual(reservarComentario(rota, comentario), { nuestro: false, id: 0 })
})

test('un comentario no abre la ventana de 24 horas; un mensaje sí', () => {
    const { sql } = baseDeCliente()
    reservarComentario(sql, comentario)
    assert.equal(ultimoMensajeDe(sql, 'persona-1'), null)

    guardarMensaje(sql, { de: 'persona-1', texto: 'hola' })
    const cuando = ultimoMensajeDe(sql, 'persona-1')
    assert.ok(cuando && Date.now() - cuando.getTime() < 60_000)
})

test('la ventana se mide desde el último mensaje, no desde el primero', () => {
    const { sql, db } = baseDeCliente()
    db.prepare(`INSERT INTO eventos (tipo, de, creado) VALUES ('mensaje', 'persona-1', ?)`).run(haceMinutos(3000))
    db.prepare(`INSERT INTO eventos (tipo, de, creado) VALUES ('mensaje', 'persona-1', ?)`).run(haceMinutos(5))
    const cuando = ultimoMensajeDe(sql, 'persona-1')!
    assert.ok(Date.now() - cuando.getTime() < 10 * 60_000)
})

test('cerrar una reserva con un fallo no borra lo que ya se había anotado', () => {
    const { sql, db } = baseDeCliente()
    const { id } = reservarComentario(sql, comentario)
    cerrarReserva(sql, id, null, null, { respuesta: 'Te paso la info', origen: 'fija' })
    cerrarReserva(sql, id, null, 'HTTP 400: token caducado')

    const f = fila<{ respondido: number; error: string; respuesta: string; origen: string }>(
        db,
        `SELECT respondido, error, respuesta, origen FROM eventos WHERE id = ?`,
        id,
    )
    assert.deepEqual({ ...f }, {
        respondido: 0,
        error: 'HTTP 400: token caducado',
        respuesta: 'Te paso la info',
        origen: 'fija',
    })
})
