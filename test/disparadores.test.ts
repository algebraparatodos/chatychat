import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buscarDisparador, contarDisparo, normalizar } from '../src/disparadores'
import { baseDeCliente, fila } from './apoyo'

/**
 * Las automatizaciones de un vivero inventado, «Luna Azul».
 *
 * Devuelve la base y los ids, para que cada prueba ajuste lo que necesite.
 */
function vivero() {
    const { sql, db } = baseDeCliente()
    const auto = (nombre: string, respuesta: string, prioridad = 0) =>
        Number(
            db
                .prepare(
                    `INSERT INTO automatizaciones (nombre, activa, respuesta, aviso_publico, prioridad)
                     VALUES (?, 1, ?, 'Te escribimos por privado', ?)`,
                )
                .run(nombre, respuesta, prioridad).lastInsertRowid,
        )
    const disparador = (automatizacion: number, tipo: string, palabras: string, objetivo: string | null = null) =>
        Number(
            db
                .prepare(
                    `INSERT INTO disparadores (automatizacion_id, tipo, palabras, objetivo) VALUES (?, ?, ?, ?)`,
                )
                .run(automatizacion, tipo, palabras, objetivo).lastInsertRowid,
        )
    return { sql, db, auto, disparador }
}

test('normalizar quita acentos, mayúsculas y espacios de más', () => {
    assert.equal(normalizar('  ¿Cuánto   SALE la Maceta? '), '¿cuanto sale la maceta?')
})

test('una palabra coincide aunque la persona la escriba con acento y en mayúsculas', () => {
    const { sql, auto, disparador } = vivero()
    const precios = auto('Precios', 'La maceta mediana sale 12 €.')
    disparador(precios, 'comentario', 'precio|cuanto')

    const elegida = buscarDisparador(sql, 'Hola! CUÁNTO cuesta la grande?', 'comentario', 'media-1')
    assert.equal(elegida?.automatizacion, precios)
    assert.equal(elegida?.respuesta, 'La maceta mediana sale 12 €.')
    assert.equal(elegida?.avisoPublico, 'Te escribimos por privado')
})

test('sin ninguna palabra que coincida no se contesta', () => {
    const { sql, auto, disparador } = vivero()
    disparador(auto('Precios', 'Sale 12 €.'), 'comentario', 'precio')
    assert.equal(buscarDisparador(sql, 'qué lindas las fotos', 'comentario', 'media-1'), null)
})

test('una automatización apagada o archivada no contesta, aunque coincida', () => {
    const { sql, db, auto, disparador } = vivero()
    const apagada = auto('Apagada', 'no')
    const archivada = auto('Archivada', 'tampoco')
    disparador(apagada, 'comentario', 'info')
    disparador(archivada, 'comentario', 'info')
    db.prepare(`UPDATE automatizaciones SET activa = 0 WHERE id = ?`).run(apagada)
    db.prepare(`UPDATE automatizaciones SET archivada = 1 WHERE id = ?`).run(archivada)

    assert.equal(buscarDisparador(sql, 'info', 'comentario', 'media-1'), null)
})

test('un disparador desactivado no contesta', () => {
    const { sql, db, auto, disparador } = vivero()
    const d = disparador(auto('Info', 'Te paso la info'), 'comentario', 'info')
    db.prepare(`UPDATE disparadores SET activo = 0 WHERE id = ?`).run(d)
    assert.equal(buscarDisparador(sql, 'info', 'comentario', 'media-1'), null)
})

test('un comentario no despierta un disparador de mensajes directos', () => {
    const { sql, auto, disparador } = vivero()
    disparador(auto('Info por DM', 'Te paso la info'), 'mensaje', 'info')
    assert.equal(buscarDisparador(sql, 'info', 'comentario', 'media-1'), null)
    assert.notEqual(buscarDisparador(sql, 'info', 'mensaje', undefined), null)
})

test('un disparador atado a una publicación sólo contesta en esa publicación', () => {
    const { sql, auto, disparador } = vivero()
    disparador(auto('Sorteo', 'Ya estás participando'), 'comentario', 'quiero', 'media-sorteo')
    assert.equal(buscarDisparador(sql, 'quiero', 'comentario', 'otra-media'), null)
    assert.equal(buscarDisparador(sql, 'quiero', 'comentario', 'media-sorteo')?.nombre, 'Sorteo')
})

test('a igual prioridad, el disparador atado a la publicación le gana al general', () => {
    const { sql, auto, disparador } = vivero()
    disparador(auto('General', 'Respuesta general'), 'comentario', 'info')
    disparador(auto('De esta publicación', 'Respuesta concreta'), 'comentario', 'info', 'media-7')
    assert.equal(buscarDisparador(sql, 'info', 'comentario', 'media-7')?.nombre, 'De esta publicación')
})

test('la prioridad manda por encima de lo concreto', () => {
    const { sql, auto, disparador } = vivero()
    disparador(auto('Concreta', 'Respuesta concreta'), 'comentario', 'info', 'media-7')
    disparador(auto('Urgente', 'Respuesta urgente', 10), 'comentario', 'info')
    assert.equal(buscarDisparador(sql, 'info', 'comentario', 'media-7')?.nombre, 'Urgente')
})

test('una respuesta a una historia sin palabras dispara con cualquier texto', () => {
    const { sql, auto, disparador } = vivero()
    disparador(auto('Historia', 'Gracias por escribir!'), 'historia', '', 'historia-1')
    assert.equal(buscarDisparador(sql, '😍', 'historia', 'historia-1')?.nombre, 'Historia')
})

test('contarDisparo suma uno a la automatización y al disparador que la despertó', () => {
    const { sql, db, auto, disparador } = vivero()
    const a = auto('Info', 'Te paso la info')
    const d = disparador(a, 'comentario', 'info')
    const elegida = buscarDisparador(sql, 'info', 'comentario', 'media-1')!
    contarDisparo(sql, elegida)
    contarDisparo(sql, elegida)

    assert.equal(fila<{ disparos: number }>(db, `SELECT disparos FROM automatizaciones WHERE id = ?`, a)?.disparos, 2)
    assert.equal(fila<{ disparos: number }>(db, `SELECT disparos FROM disparadores WHERE id = ?`, d)?.disparos, 2)
})
