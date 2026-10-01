/**
 * Lo que pasa entre que llega un aviso de Meta y sale la respuesta.
 *
 * Todo dentro de la base de un cliente inventado, el vivero «Luna Azul»,
 * y con `fetch` interceptado: lo que se comprueba es qué se le habría
 * mandado a Meta, sin mandárselo.
 */

import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

import { atenderEntrada, type Entrada, type Quien } from '../src/atender'
import { baseDeCliente, fila, filas, interceptarRed, type Llamada } from './apoyo'

const CUENTA = 'cuenta-luna-azul'
const QUIEN: Quien = { clave: 'luna-azul', cred: { flujo: 'instagram', token: 'token-de-prueba' }, cuenta: CUENTA }

let red: ReturnType<typeof interceptarRed>
let llamadas: Llamada[]
beforeEach(() => {
    red = interceptarRed()
    llamadas = red.llamadas
})
afterEach(() => red.restaurar())

/** Una automatización de precios que escucha comentarios y mensajes. */
function vivero(avisoPublico: string | null = 'Te escribimos por privado 🌱') {
    const { sql, db } = baseDeCliente()
    const auto = Number(
        db
            .prepare(`INSERT INTO automatizaciones (nombre, activa, respuesta, aviso_publico) VALUES ('Precios', 1, ?, ?)`)
            .run('La maceta mediana sale 12 €. ¿Te la reservo?', avisoPublico).lastInsertRowid,
    )
    db.prepare(`INSERT INTO disparadores (automatizacion_id, tipo, palabras) VALUES (?, 'comentario', 'precio')`).run(auto)
    db.prepare(`INSERT INTO disparadores (automatizacion_id, tipo, palabras) VALUES (?, 'mensaje', 'precio')`).run(auto)
    return { sql, db, auto }
}

function comentario(texto: string, de = 'persona-1', id = 'c-1'): Entrada {
    return {
        id: CUENTA,
        changes: [{ field: 'comments', value: { id, text: texto, from: { id: de, username: 'ana.plantas' }, media: { id: 'media-1' } } }],
    }
}

function mensaje(m: NonNullable<Entrada['messaging']>[number]): Entrada {
    return { id: CUENTA, messaging: [m] }
}

// ── Comentarios ──────────────────────────────────────────────────

test('un comentario que coincide recibe la respuesta privada y después el aviso público', async () => {
    const { sql, db } = vivero()
    await atenderEntrada(comentario('precio?'), QUIEN, sql)

    assert.equal(llamadas.length, 2)
    assert.equal(llamadas[0].url, 'https://graph.instagram.com/v23.0/me/messages?access_token=token-de-prueba')
    assert.deepEqual(llamadas[0].cuerpo, {
        recipient: { comment_id: 'c-1' },
        message: { text: 'La maceta mediana sale 12 €. ¿Te la reservo?' },
    })
    assert.equal(llamadas[1].url, 'https://graph.instagram.com/v23.0/c-1/replies?access_token=token-de-prueba')
    assert.deepEqual(llamadas[1].cuerpo, { message: 'Te escribimos por privado 🌱' })

    const evento = fila<{ respondido: number; origen: string; aviso_enviado: string }>(
        db,
        `SELECT respondido, origen, aviso_enviado FROM eventos WHERE comentario_id = 'c-1'`,
    )
    assert.deepEqual({ ...evento }, { respondido: 1, origen: 'fija', aviso_enviado: 'Te escribimos por privado 🌱' })
})

test('el mismo comentario llega dos veces y se contesta una', async () => {
    const { sql } = vivero(null)
    await atenderEntrada(comentario('precio?'), QUIEN, sql)
    await atenderEntrada(comentario('precio?'), QUIEN, sql)
    assert.equal(llamadas.length, 1)
})

test('un comentario de la propia cuenta no se contesta: sería el bot contestándose a sí mismo', async () => {
    const { sql, db } = vivero()
    await atenderEntrada(comentario('precio', CUENTA), QUIEN, sql)
    assert.equal(llamadas.length, 0)
    assert.equal(filas(db, `SELECT id FROM eventos`).length, 0)
})

test('un comentario que no dispara nada se guarda igual, para contestarlo a mano', async () => {
    const { sql, db } = vivero()
    await atenderEntrada(comentario('qué lindas!'), QUIEN, sql)
    assert.equal(llamadas.length, 0)
    assert.equal(fila<{ respondido: number }>(db, `SELECT respondido FROM eventos`)?.respondido, 0)
})

test('sin sitio en el tope de la hora, la respuesta se aparta para luego en vez de perderse', async () => {
    const { sql, db } = vivero()
    const hora = new Date().toISOString().slice(0, 13).replace('T', ' ')
    db.prepare(`INSERT INTO ritmo (hora, llamadas) VALUES (?, 699)`).run(hora)

    await atenderEntrada(comentario('precio?'), QUIEN, sql)

    assert.equal(llamadas.length, 0)
    const pendiente = fila<{ tipo: string; estado: string; comentario_id: string; texto: string }>(
        db,
        `SELECT tipo, estado, comentario_id, texto FROM pendientes`,
    )
    assert.deepEqual({ ...pendiente }, {
        tipo: 'comentario',
        estado: 'espera',
        comentario_id: 'c-1',
        texto: 'La maceta mediana sale 12 €. ¿Te la reservo?',
    })
})

test('si Meta rechaza el envío, el error queda guardado en el evento', async () => {
    red.restaurar()
    red = interceptarRed(() => new Response('{"error":"Invalid OAuth access token"}', { status: 400 }))
    const { sql, db } = vivero(null)

    await atenderEntrada(comentario('precio?'), QUIEN, sql)

    const evento = fila<{ respondido: number; error: string }>(db, `SELECT respondido, error FROM eventos`)
    assert.equal(evento?.respondido, 0)
    assert.match(evento!.error, /^HTTP 400/)
})

// ── Mensajes directos ────────────────────────────────────────────

test('un eco de la propia cuenta se ignora', async () => {
    const { sql, db } = vivero()
    await atenderEntrada(mensaje({ sender: { id: CUENTA }, message: { is_echo: true, text: 'precio' } }), QUIEN, sql)
    assert.equal(llamadas.length, 0)
    assert.equal(filas(db, `SELECT id FROM eventos`).length, 0)
})

test('un mensaje directo abre la ventana y se contesta en el acto', async () => {
    const { sql, db } = vivero()
    await atenderEntrada(mensaje({ sender: { id: 'persona-2' }, message: { text: 'Precio de la grande?' } }), QUIEN, sql)

    assert.equal(llamadas.length, 1)
    assert.deepEqual(llamadas[0].cuerpo.recipient, { id: 'persona-2' })
    assert.equal(fila<{ respondido: number }>(db, `SELECT respondido FROM eventos WHERE de = 'persona-2'`)?.respondido, 1)
})

test('un flujo con botones arranca por mensaje directo, y por Facebook Login sale contra la Página', async () => {
    const { sql, db, auto } = vivero()
    const precios = Number(
        db.prepare(`INSERT INTO nodos (automatizacion_id, texto, orden) VALUES (?, 'Mediana 12 €, grande 18 €.', 1)`).run(auto)
            .lastInsertRowid,
    )
    const inicio = Number(
        db.prepare(`INSERT INTO nodos (automatizacion_id, texto, orden) VALUES (?, '¿Qué tamaño buscás?', 0)`).run(auto)
            .lastInsertRowid,
    )
    const boton = Number(
        db.prepare(`INSERT INTO botones (nodo_id, texto, tipo, destino) VALUES (?, 'Ver precios', 'ir', ?)`).run(inicio, precios)
            .lastInsertRowid,
    )
    const porFacebook: Quien = { ...QUIEN, cred: { flujo: 'facebook', token: 'token-de-pagina', pagina: 'pagina-1' } }

    await atenderEntrada(mensaje({ sender: { id: 'persona-3' }, message: { text: 'precio' } }), porFacebook, sql)

    assert.equal(llamadas.length, 1)
    assert.equal(llamadas[0].url, 'https://graph.facebook.com/v23.0/pagina-1/messages?access_token=token-de-pagina')
    assert.deepEqual(llamadas[0].cuerpo.message.attachment.payload, {
        template_type: 'button',
        text: '¿Qué tamaño buscás?',
        buttons: [{ type: 'postback', payload: `b${boton}`, title: 'Ver precios' }],
    })

    // El clic sigue el flujo, y se guarda como mensaje: es actividad suya.
    await atenderEntrada(mensaje({ sender: { id: 'persona-3' }, postback: { payload: `b${boton}` } }), porFacebook, sql)
    assert.equal(llamadas.length, 2)
    assert.deepEqual(llamadas[1].cuerpo.message, { text: 'Mediana 12 €, grande 18 €.' })
    assert.equal(
        fila<{ texto: string }>(db, `SELECT texto FROM eventos WHERE de = 'persona-3' ORDER BY id DESC`)?.texto,
        `[boton] b${boton}`,
    )
})

test('una cadena de cajas que se apunta a sí misma se corta a las cinco', async () => {
    const { sql, db, auto } = vivero()
    const caja = Number(
        db.prepare(`INSERT INTO nodos (automatizacion_id, texto, orden) VALUES (?, 'Hola otra vez', 0)`).run(auto)
            .lastInsertRowid,
    )
    db.prepare(`UPDATE nodos SET siguiente = ? WHERE id = ?`).run(caja, caja)

    await atenderEntrada(mensaje({ sender: { id: 'persona-4' }, message: { text: 'precio' } }), QUIEN, sql)
    assert.equal(llamadas.length, 5)
})
