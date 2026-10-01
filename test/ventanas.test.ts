import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
    ajustarBotones,
    fechaDe,
    recortar,
    sePuedeEscribirAlBuzon,
    sePuedeResponderAlComentario,
    BOTONES_POR_MENSAJE,
    LARGO_BOTON,
    LARGO_MENSAJE,
    LARGO_PRIVADO,
    type Boton,
} from '../src/ventanas'

const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000)
const HORA = 60
const DIA = 24 * HORA

// ── La respuesta privada a un comentario: 7 días ─────────────────

test('un comentario de hace seis días todavía admite respuesta privada, sin botones', () => {
    const p = sePuedeResponderAlComentario(hace(6 * DIA))
    assert.deepEqual(p, { vale: true, largoMaximo: LARGO_PRIVADO, admiteBotones: false })
})

test('a los siete días el comentario ya no admite respuesta privada', () => {
    const p = sePuedeResponderAlComentario(hace(7 * DIA))
    assert.equal(p.vale, false)
})

test('un comentario sin fecha se contesta: es el caso normal de un webhook recién llegado', () => {
    assert.equal(sePuedeResponderAlComentario(null).vale, true)
})

// ── El buzón: la ventana de 24 horas ─────────────────────────────

test('a quien nunca mandó un mensaje no se le escribe al buzón', () => {
    const p = sePuedeEscribirAlBuzon(null)
    assert.equal(p.vale, false)
})

test('dentro de la ventana se puede escribir, con botones y hasta 1000 caracteres', () => {
    const p = sePuedeEscribirAlBuzon(hace(HORA))
    assert.deepEqual(p, { vale: true, largoMaximo: LARGO_MENSAJE, admiteBotones: true })
})

test('la ventana se da por cerrada diez minutos antes de las 24 horas', () => {
    assert.equal(sePuedeEscribirAlBuzon(hace(DIA - 11)).vale, true)
    assert.equal(sePuedeEscribirAlBuzon(hace(DIA - 9)).vale, false)
})

test('pasadas las 24 horas no se escribe', () => {
    assert.equal(sePuedeEscribirAlBuzon(hace(DIA + HORA)).vale, false)
})

// ── Recortar al largo de cada puerta ─────────────────────────────

test('un texto que cabe sale tal cual, sin espacios alrededor', () => {
    assert.equal(recortar('  Hola, te paso la info  ', 640), 'Hola, te paso la info')
})

test('un texto largo se corta por palabra y termina en puntos suspensivos', () => {
    const texto = 'Tenemos macetas de barro esmaltado en tres tamaños y envíos a todo el país'
    const corto = recortar(texto, 40)
    assert.ok(corto.length <= 40)
    assert.ok(corto.endsWith('…'))
    assert.ok(texto.startsWith(corto.slice(0, -1)))
    assert.notEqual(corto.at(-2), ' ')
})

test('sin un espacio razonable donde cortar, se corta a mitad de palabra', () => {
    const corto = recortar('a'.repeat(100), 10)
    assert.equal(corto, `${'a'.repeat(9)}…`)
})

// ── Botones ──────────────────────────────────────────────────────

test('más de tres botones: se mandan los tres primeros en vez de rechazar el mensaje', () => {
    const botones: Boton[] = [1, 2, 3, 4].map((i) => ({ titulo: `Opción ${i}`, payload: `b${i}` }))
    const puestos = ajustarBotones(botones, 'luna-azul')
    assert.equal(puestos.length, BOTONES_POR_MENSAJE)
    assert.deepEqual(puestos.map((b) => b.payload), ['b1', 'b2', 'b3'])
})

test('un título de más de veinte caracteres se recorta, y el tipo de botón se conserva', () => {
    const puestos = ajustarBotones(
        [
            { titulo: '  Ver el catálogo completo de macetas  ', url: 'https://example.com/catalogo' },
            { titulo: 'Precios', payload: 'b7' },
        ],
        'luna-azul',
    )
    assert.equal(puestos[0].titulo.length, LARGO_BOTON)
    assert.equal(puestos[0].url, 'https://example.com/catalogo')
    assert.equal(puestos[0].payload, undefined)
    assert.deepEqual(puestos[1], { titulo: 'Precios', payload: 'b7' })
})

// ── Fechas de la base ────────────────────────────────────────────

test('las fechas de SQLite se leen como UTC', () => {
    assert.equal(fechaDe('2026-09-21 10:30:00')?.toISOString(), '2026-09-21T10:30:00.000Z')
})

test('una fecha vacía o ilegible es null, no una fecha inventada', () => {
    assert.equal(fechaDe(null), null)
    assert.equal(fechaDe(''), null)
    assert.equal(fechaDe('ayer'), null)
})
