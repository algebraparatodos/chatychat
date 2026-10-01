/**
 * Lo que llega, y cómo se evita contestarlo dos veces.
 *
 * ── El problema que resuelve este archivo ──────────────────────────
 *
 * **El mismo comentario llega más de una vez.** Pasa cuando hay dos apps
 * conectadas a la misma cuenta de Instagram, y las dos copias entran con
 * menos de un segundo de diferencia. Si no se hace nada, el bot contesta
 * dos veces a la misma persona.
 *
 * Y no se arregla preguntando antes: entre un `SELECT` que dice «todavía
 * no está» y el `INSERT` que lo apunta cabe perfectamente la otra copia,
 * haciendo lo mismo. Las dos preguntan, las dos oyen que no, las dos
 * contestan.
 *
 * Lo que sí lo arregla es **apartar la plaza con un INSERT antes de
 * contestar**, y dejar que el índice único sobre `comentario_id` decida
 * sin carrera posible. Quien choca, se calla.
 */

import { fechaDe } from './ventanas'

export type Reserva = { nuestro: boolean; id: number }

/**
 * Aparta el comentario y dice si nos tocó atenderlo a nosotros.
 *
 * Devuelve `nuestro: false` también cuando la base falla por cualquier
 * otro motivo, y es deliberado: **ante la duda, no contestar**. Un
 * mensaje que no sale se puede mandar a mano; uno que sale dos veces ya
 * lo recibió la persona.
 */
export function reservarComentario(
    sql: SqlStorage,
    e: {
        de: string
        usuario?: string
        texto?: string
        comentarioId: string
        mediaId?: string
    },
): Reserva {
    try {
        const fila = [
            ...sql.exec<{ id: number }>(
                `INSERT INTO eventos (tipo, de, usuario, texto, comentario_id, media_id, respondido)
                 VALUES ('comentario', ?1, ?2, ?3, ?4, ?5, 0)
                 RETURNING id`,
                e.de,
                e.usuario ?? null,
                e.texto ?? null,
                e.comentarioId,
                e.mediaId ?? null,
            ),
        ][0]

        tocarContacto(sql, e.de, e.usuario)
        return { nuestro: true, id: fila?.id ?? 0 }
    } catch (err) {
        const texto = String(err)
        // El choque del índice único es el caso normal, no un error: es
        // la otra copia del mismo comentario.
        if (texto.includes('UNIQUE')) return { nuestro: false, id: 0 }
        console.error(`[base] no se pudo reservar el comentario ${e.comentarioId}: ${texto}`)
        return { nuestro: false, id: 0 }
    }
}

/** Anota en la reserva qué automatización contestó y cómo salió. */
export type Enviado = {
    /** El texto que se le mando a la persona, tal cual salio. */
    respuesta?: string | null
    /** El aviso publico, si lo hubo. */
    aviso?: string | null
    /** 'ia' si la escribio el modelo, 'fija' si es la de la automatizacion. */
    origen?: 'ia' | 'fija' | null
    tokensEntrada?: number | null
    tokensSalida?: number | null
}

export function cerrarReserva(
    sql: SqlStorage,
    id: number,
    automatizacion: number | null,
    fallo: string | null,
    enviado: Enviado = {},
): void {
    if (!id) return
    try {
        sql.exec(
            `UPDATE eventos
                SET automatizacion_id = ?2,
                    respondido        = ?3,
                    error             = ?4,
                    respuesta         = COALESCE(?5, respuesta),
                    aviso_enviado     = COALESCE(?6, aviso_enviado),
                    origen            = COALESCE(?7, origen),
                    tokens_entrada    = COALESCE(?8, tokens_entrada),
                    tokens_salida     = COALESCE(?9, tokens_salida)
              WHERE id = ?1`,
            id,
            automatizacion,
            fallo ? 0 : 1,
            fallo ?? null,
            // COALESCE y no asignacion directa: asi una llamada que no
            // sabe nada del texto —la que solo anota un fallo— no borra
            // lo que otra ya habia escrito.
            enviado.respuesta ?? null,
            enviado.aviso ?? null,
            enviado.origen ?? null,
            enviado.tokensEntrada ?? null,
            enviado.tokensSalida ?? null,
        )
    } catch (err) {
        console.error(`[base] no se pudo cerrar la reserva ${id}: ${err}`)
    }
}

/**
 * Guarda un mensaje directo o una respuesta a una historia.
 *
 * No lleva reserva porque **los mensajes no se duplican como los
 * comentarios**: cada uno trae su `mid` y llega por un solo canal. Si
 * algún día se vieran duplicados, el sitio de arreglarlo es éste, con un
 * índice único sobre el `mid`.
 *
 * ── Devuelve el id, y hace falta ───────────────────────────────────
 *
 * El mensaje se guarda **antes** de contestar, así que en ese momento
 * todavía no se sabe cómo salió el envío. Sin el id no hay forma de
 * volver a la fila después para anotarlo, y eso es justo lo que pasaba
 * hasta el 22/09/2026: todos los mensajes directos contestados quedaban
 * como `respondido = 0`, y un envío fallido no dejaba rastro ninguno en
 * la base, sólo una línea en el registro del Worker que caduca.
 *
 * Con el id, quien contesta cierra la fila con `cerrarReserva()`, la
 * misma que usan los comentarios.
 */
export function guardarMensaje(
    sql: SqlStorage,
    e: {
        de: string
        texto?: string
        mediaId?: string
        canal?: string
        automatizacion?: number | null
        respondido?: boolean
        error?: string | null
    },
): number {
    try {
        const fila = [
            ...sql.exec<{ id: number }>(
                `INSERT INTO eventos
                    (tipo, de, texto, media_id, canal, automatizacion_id, respondido, error)
                 VALUES ('mensaje', ?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 RETURNING id`,
                e.de,
                e.texto ?? null,
                e.mediaId ?? null,
                e.canal ?? null,
                e.automatizacion ?? null,
                e.respondido ? 1 : 0,
                e.error ?? null,
            ),
        ][0]

        tocarContacto(sql, e.de)
        return fila?.id ?? 0
    } catch (err) {
        console.error(`[base] no se pudo guardar el mensaje de ${e.de}: ${err}`)
        return 0
    }
}

/**
 * Apunta que esa persona escribió.
 *
 * Va aparte de guardar el evento porque **se actualiza aunque el evento
 * sea un duplicado**: que el aviso llegara dos veces no cambia que la
 * persona escribió una.
 */
function tocarContacto(sql: SqlStorage, de: string, usuario?: string): void {
    try {
        sql.exec(
            `INSERT INTO contactos (de, usuario)
             VALUES (?1, ?2)
             ON CONFLICT(de) DO UPDATE SET
                 usuario    = COALESCE(excluded.usuario, contactos.usuario),
                 veces      = contactos.veces + 1,
                 ultima_vez = datetime('now')`,
            de,
            usuario ?? null,
        )
    } catch (err) {
        console.error(`[base] no se pudo apuntar el contacto ${de}: ${err}`)
    }
}

/**
 * Cuándo escribió por última vez esta persona.
 *
 * Es **lo que abre la ventana de 24 horas**, así que de esta consulta
 * depende que se le pueda escribir o no. Y por eso filtra por tipo: un
 * comentario suyo no cuenta, sólo un mensaje. Un clic en un botón sí,
 * porque se guarda como mensaje.
 *
 * Ante un fallo de la base devuelve `null`, o sea «no ha escrito nunca»,
 * o sea «no le escribas». Es la dirección segura: mandar fuera de la
 * ventana no es un error técnico, es romper una norma de Meta en nombre
 * del cliente, y eso le puede costar el canal.
 */
export function ultimoMensajeDe(sql: SqlStorage, de: string): Date | null {
    try {
        const fila = [
            ...sql.exec<{ creado: string }>(
                `SELECT creado FROM eventos
                  WHERE de = ? AND tipo = 'mensaje'
                  ORDER BY id DESC LIMIT 1`,
                de,
            ),
        ][0]
        return fechaDe(fila?.creado)
    } catch (err) {
        console.error(`[eventos] no se pudo mirar la ventana de ${de}: ${err}`)
        return null
    }
}
