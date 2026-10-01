/**
 * Lo que hay que mandar más tarde.
 *
 * ── De dónde sale un pendiente ─────────────────────────────────────
 *
 * De dos sitios, y son distintos:
 *
 *  - **Un flujo con espera.** «Mándale esto dentro de 23 horas», que es
 *    el seguimiento típico de esta clase de automatizaciones.
 *  - **El tope de la hora.** Una respuesta privada que no cupo. Se
 *    aparta en vez de tirarse, porque el plazo de una respuesta privada
 *    es de 7 días y lo que no cabe ahora cabe dentro de una hora.
 *
 * ── Ya no lo barre un cron: lo despierta una alarma ────────────────
 *
 * Antes esto lo recorría un cron cada cinco minutos, **para todos los
 * clientes a la vez**, preguntándole a cada uno si tenía algo. Con mil
 * clientes son doce mil consultas por hora para, casi siempre, no
 * encontrar nada.
 *
 * Ahora el objeto de cada cliente se pone una alarma a la hora exacta de
 * su primer pendiente. Un cliente sin esperas no cuesta nada, y una
 * espera de 23 horas llega a su hora y no cinco minutos tarde.
 *
 * ── La ventana de 24 horas no se comprueba aquí ────────────────────
 *
 * Se le pregunta a `ventanas.ts`, que es **el único sitio que decide si
 * un envío está permitido**. Este módulo tenía su propia copia de la
 * regla, con sus propias constantes de 24 horas y 10 minutos de margen.
 * Dos copias de una norma de Meta es una forma segura de que un día
 * digan cosas distintas, y la que estaba mal sería la que rompe la
 * cuenta de un cliente.
 */

import { ultimoMensajeDe } from './eventos'
import { responder, responderComentario, type Credencial } from './enviar'
import { cabenEstaHora } from './ritmo'
import { sePuedeEscribirAlBuzon } from './ventanas'

/**
 * Cuántos se atienden por vez.
 *
 * Cincuenta. No es por tiempo de CPU —un objeto tiene hasta cinco
 * minutos— sino por no vaciar de golpe el tope de llamadas por hora de
 * la cuenta del cliente, que hace falta para contestar a quien escribe
 * **ahora**. Lo que no entra se despierta en la alarma siguiente.
 */
const POR_PASADA = 50

/** Apunta una caja de un flujo para dentro de un rato. */
export function programar(
    sql: SqlStorage,
    destino: string,
    nodoId: number,
    dentroDeMinutos: number,
): void {
    try {
        sql.exec(
            `INSERT INTO pendientes (destino, nodo_id, cuando)
             VALUES (?1, ?2, datetime('now', ?3))`,
            destino,
            nodoId,
            `+${Math.round(dentroDeMinutos)} minutes`,
        )
    } catch (err) {
        console.error(`[pendientes] no se pudo programar para ${destino}: ${err}`)
    }
}

/**
 * Aparta una respuesta privada que no cupo en el tope de esta hora.
 *
 * Dentro de una hora, que es cuando el contador de Meta se renueva. No
 * antes: reintentar a los cinco minutos con el tope agotado sólo gasta
 * una llamada más de las que no hay.
 */
export function apartarParaLuego(
    sql: SqlStorage,
    destino: string,
    texto: string,
    comentarioId: string,
): void {
    try {
        sql.exec(
            `INSERT INTO pendientes (destino, texto, tipo, comentario_id, cuando)
             VALUES (?1, ?2, 'comentario', ?3, datetime('now', '+1 hour'))`,
            destino,
            texto,
            comentarioId,
        )
    } catch (err) {
        console.error(`[pendientes] no se pudo apartar la respuesta a ${comentarioId}: ${err}`)
    }
}

export type Resumen = { enviados: number; caducados: number; fallos: number }

/**
 * Manda los que ya tocan.
 *
 * ── Por qué se marca antes de enviar, aunque haya un solo objeto ───
 *
 * Dentro de un Durable Object no hay dos pasadas compitiendo, así que
 * podría parecer que sobra. No sobra, y el motivo es preciso: **mientras
 * se espera una respuesta de Meta, el objeto sí puede atender otra cosa**.
 * Las esperas de almacenamiento están protegidas; las de red no.
 *
 * O sea que entre el `await` del envío y su vuelta puede entrar un
 * webhook y disparar otra pasada. Marcar primero y enviar después hace
 * que la segunda no encuentre nada.
 *
 * Se paga con que un pendiente puede quedar marcado como enviado sin
 * haber salido, si el objeto muere justo en medio. Es el lado bueno del
 * que hay que equivocarse: **mejor uno que no sale que uno que sale dos
 * veces**.
 */
export async function barrer(sql: SqlStorage, cred: Credencial, cliente: string): Promise<Resumen> {
    const resumen: Resumen = { enviados: 0, caducados: 0, fallos: 0 }

    const listos = [
        ...sql.exec<{
            id: number
            destino: string
            tipo: string
            comentario_id: string | null
            texto: string | null
        }>(
            // LEFT JOIN y COALESCE: un pendiente puede traer su propio
            // texto y no venir de ninguna caja, que es lo que pasa cuando
            // se aparta por el tope de la hora. Con un JOIN normal esos
            // no saldrian nunca, y el sintoma seria que se quedan en
            // espera para siempre sin que nada falle.
            `SELECT p.id, p.destino, p.tipo, p.comentario_id,
                    COALESCE(p.texto, n.texto) AS texto
               FROM pendientes p
               LEFT JOIN nodos n ON n.id = p.nodo_id
              WHERE p.estado = 'espera' AND p.cuando <= datetime('now')
              ORDER BY p.cuando ASC
              LIMIT ?`,
            POR_PASADA,
        ),
    ]

    for (const p of listos) {
        if (!apartar(sql, p.id)) continue

        if (!p.texto?.trim()) {
            cerrar(sql, p.id, 'fallo', 'la caja no tiene texto')
            resumen.fallos++
            continue
        }

        // Una respuesta privada a un comentario **no pasa por la ventana
        // de 24 horas**: tiene 7 dias y se manda contra el comentario.
        // Solo los mensajes al buzon dependen de que la persona haya
        // escrito.
        const esComentario = p.tipo === 'comentario' && p.comentario_id

        if (!esComentario) {
            const permiso = sePuedeEscribirAlBuzon(ultimoMensajeDe(sql, p.destino))
            if (!permiso.vale) {
                cerrar(sql, p.id, 'caducado', permiso.motivo)
                resumen.caducados++
                console.log(`[${cliente}] pendiente ${p.id} caducado: ${permiso.motivo}`)
                continue
            }
        }

        // El tope por hora vale igual aqui. Si no cabe, se devuelve a la
        // cola en vez de gastar el intento: apartarlo fue justamente para
        // no perderlo.
        if (!cabenEstaHora(sql, 1, cliente)) {
            devolverALaCola(sql, p.id)
            continue
        }

        const fallo = esComentario
            ? await responderComentario(p.comentario_id!, p.texto, cred)
            : await responder(p.destino, p.texto, cred)

        if (fallo) {
            cerrar(sql, p.id, 'fallo', fallo)
            resumen.fallos++
        } else {
            cerrar(sql, p.id, 'enviado', null)
            resumen.enviados++
        }
    }

    return resumen
}

/**
 * Marca uno como en curso y dice si lo cogimos nosotros.
 *
 * El `WHERE estado = 'espera'` es lo que lo hace seguro: si otra pasada
 * ya lo cambió, esta actualización no toca ninguna fila y `rowsWritten`
 * es cero.
 */
function apartar(sql: SqlStorage, id: number): boolean {
    try {
        return (
            sql.exec(
                `UPDATE pendientes
                    SET estado = 'enviando', intentos = intentos + 1
                  WHERE id = ? AND estado = 'espera'`,
                id,
            ).rowsWritten > 0
        )
    } catch (err) {
        console.error(`[pendientes] no se pudo apartar ${id}: ${err}`)
        return false
    }
}

/**
 * Lo devuelve a la cola, una hora más tarde.
 *
 * Se usa cuando el tope de la hora impide mandarlo: ya estaba apartado
 * como «enviando», así que sin esto se quedaría en ese estado para
 * siempre, que es la peor forma de perder un mensaje porque no aparece
 * ni como fallo ni como pendiente.
 */
function devolverALaCola(sql: SqlStorage, id: number): void {
    try {
        sql.exec(
            `UPDATE pendientes
                SET estado = 'espera', cuando = datetime('now', '+1 hour')
              WHERE id = ?`,
            id,
        )
    } catch (err) {
        console.error(`[pendientes] no se pudo devolver ${id} a la cola: ${err}`)
    }
}

function cerrar(
    sql: SqlStorage,
    id: number,
    estado: 'enviado' | 'fallo' | 'caducado',
    error: string | null,
): void {
    try {
        sql.exec(
            `UPDATE pendientes
                SET estado = ?2, error = ?3, terminado = datetime('now')
              WHERE id = ?1`,
            id,
            estado,
            error,
        )
    } catch (err) {
        console.error(`[pendientes] no se pudo cerrar ${id}: ${err}`)
    }
}

/** Cuándo toca el próximo, para poner la alarma. `null` si no hay. */
export function proximoPendiente(sql: SqlStorage): number | null {
    const fila = [
        ...sql.exec<{ cuando: string }>(
            `SELECT cuando FROM pendientes WHERE estado = 'espera' ORDER BY cuando ASC LIMIT 1`,
        ),
    ][0]
    if (!fila) return null
    const t = Date.parse(`${fila.cuando.replace(' ', 'T')}Z`)
    return Number.isNaN(t) ? null : t
}
