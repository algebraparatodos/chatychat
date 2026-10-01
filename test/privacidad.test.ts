/**
 * Las dos direcciones que Meta exige antes de revisar la app: el aviso de
 * que un negocio nos desconectó y la solicitud de borrar los datos de
 * una persona. Las dos llegan como un `signed_request` firmado.
 */

import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { avisoDeDesconexion, estadoDeBorrado, solicitudDeBorrado } from '../src/privacidad'
import { baseDeControl, entorno, fila } from './apoyo'

const SECRETO_FACEBOOK = 'secreto-de-la-app-de-facebook'

/** Un sobre como los que manda Meta: firma y contenido, en base64 de URL. */
function sobre(datos: object, secreto: string): string {
    const contenido = Buffer.from(JSON.stringify(datos)).toString('base64url')
    const firma = createHmac('sha256', secreto).update(contenido).digest('base64url')
    return `${firma}.${contenido}`
}

function peticion(ruta: string, signedRequest: string): Request {
    return new Request(`https://webhook.example.com${ruta}`, {
        method: 'POST',
        body: new URLSearchParams({ signed_request: signedRequest }),
    })
}

function plataforma() {
    const { control, db } = baseDeControl()
    db.prepare(
        `INSERT INTO clientes (clave, nombre, cuenta_ig, token, estado, base_id, salud)
         VALUES ('lunaazul', 'Vivero Luna Azul', 'cuenta-luna-azul', 'token-de-prueba', 'alta', 'local', 'bien')`,
    ).run()
    const env = entorno(control, { META_APP_SECRET_FACEBOOK: SECRETO_FACEBOOK })
    return { env, db }
}

test('una solicitud de borrado mal firmada se rechaza con un 403', async () => {
    const { env, db } = plataforma()
    const res = await solicitudDeBorrado(peticion('/datos/eliminar', sobre({ user_id: 'p-1' }, 'otro-secreto')), env)
    assert.equal(res.status, 403)
    assert.equal(fila(db, `SELECT codigo FROM borrados`), undefined)
})

test('una solicitud bien firmada se apunta y devuelve a Meta el código y la página de seguimiento', async () => {
    const { env, db } = plataforma()
    const res = await solicitudDeBorrado(peticion('/datos/eliminar', sobre({ user_id: 'p-1' }, env.META_APP_SECRET)), env)

    assert.equal(res.status, 200)
    const cuerpo = (await res.json()) as { url: string; confirmation_code: string }
    assert.match(cuerpo.confirmation_code, /^[0-9a-f]{16}$/)
    assert.equal(cuerpo.url, `https://webhook.example.com/datos/estado?c=${cuerpo.confirmation_code}`)

    const apuntada = fila<{ quien: string; estado: string }>(
        db,
        `SELECT quien, estado FROM borrados WHERE codigo = ?`,
        cuerpo.confirmation_code,
    )
    assert.deepEqual({ ...apuntada }, { quien: 'p-1', estado: 'recibida' })
})

test('el código no lleva el identificador de la persona: va en una URL pública', async () => {
    const { env } = plataforma()
    const res = await solicitudDeBorrado(peticion('/datos/eliminar', sobre({ user_id: 'p-123' }, env.META_APP_SECRET)), env)
    const { url } = (await res.json()) as { url: string }
    assert.ok(!url.includes('p-123'))
})

test('la página de seguimiento dice en qué está la solicitud, y nada sin código', async () => {
    const { env, db } = plataforma()
    db.prepare(`INSERT INTO borrados (codigo, quien) VALUES ('abc123', 'p-1')`).run()

    const sin = await estadoDeBorrado(new URL('https://webhook.example.com/datos/estado'), env)
    const otro = await estadoDeBorrado(new URL('https://webhook.example.com/datos/estado?c=nohay'), env)
    const bueno = await estadoDeBorrado(new URL('https://webhook.example.com/datos/estado?c=abc123'), env)

    assert.equal(sin.status, 400)
    assert.equal(otro.status, 404)
    assert.equal(bueno.status, 200)
    assert.match(await bueno.text(), /en curso/)
})

test('un negocio que nos desconecta queda marcado sin token, y lo vale la firma de cualquiera de las apps', async () => {
    const { env, db } = plataforma()
    const res = await avisoDeDesconexion(
        peticion('/oauth/cancelada', sobre({ user_id: 'cuenta-luna-azul' }, SECRETO_FACEBOOK)),
        env,
    )
    assert.equal(res.status, 200)
    assert.equal(fila<{ salud: string }>(db, `SELECT salud FROM clientes WHERE clave = 'lunaazul'`)?.salud, 'token')
})

test('un aviso de desconexión sin firma válida no toca a ningún cliente', async () => {
    const { env, db } = plataforma()
    const res = await avisoDeDesconexion(peticion('/oauth/cancelada', 'firma.que-no-es'), env)
    assert.equal(res.status, 403)
    assert.equal(fila<{ salud: string }>(db, `SELECT salud FROM clientes WHERE clave = 'lunaazul'`)?.salud, 'bien')
})
