/**
 * Los flujos: las cajas de una automatización y los botones que las unen.
 *
 * ── Qué es un flujo aquí ───────────────────────────────────────────
 *
 * Una automatización puede ser un mensaje suelto o una conversación. La
 * conversación se guarda como **cajas** (`nodos`) unidas de dos formas:
 * por un botón que la persona pulsa, o por `siguiente`, que encadena una
 * caja con la de después sin que nadie pulse nada.
 *
 * ── La forma que imponen las reglas de Instagram ───────────────────
 *
 * Y conviene entenderla antes de diseñar un flujo, porque no es una
 * decisión nuestra: **la primera respuesta a un comentario no puede
 * llevar botones.** Los botones sólo viajan por el buzón, y el buzón
 * sólo se abre cuando la persona escribe un mensaje.
 *
 * Así que un flujo que empieza en un comentario va así:
 *
 *   comentario  →  mensaje de texto (sin botones)
 *                  ↓ si la persona contesta, se abre la ventana
 *                  mensaje con botones  →  clic  →  siguiente caja
 *
 * Un flujo que empieza en un mensaje directo sí puede llevar botones
 * desde la primera caja, porque la ventana ya está abierta: mandar un
 * mensaje es lo que la abre.
 *
 * ── Nada de esto es `async`, y es la diferencia de la mudanza ──────
 *
 * Estas consultas corren dentro del Durable Object del cliente, sobre su
 * propio SQLite, y `sql.exec()` devuelve el resultado en vez de una
 * promesa. Antes seguir un flujo de cuatro cajas eran cuatro viajes a
 * una base remota, cada uno con su espera; ahora son cuatro lecturas
 * locales.
 */

import { ajustarBotones, type Boton } from './ventanas'

/** Una caja del flujo, con sus botones. */
export type Caja = {
    id: number
    texto: string
    /** La caja de después, cuando no hay botón de por medio. */
    siguiente: number | null
    botones: Boton[]
}

type FilaDeCaja = { id: number; texto: string | null; siguiente: number | null }

/**
 * La primera caja de una automatización, con sus botones.
 *
 * Devuelve `null` si la automatización no tiene cajas, que es el caso de
 * las que son un mensaje suelto: ésas se contestan con su `respuesta` y
 * no pasan por aquí.
 */
export function primeraCaja(sql: SqlStorage, automatizacion: number, cliente: string): Caja | null {
    try {
        const fila = [
            ...sql.exec<FilaDeCaja>(
                `SELECT id, texto, siguiente
                   FROM nodos
                  WHERE automatizacion_id = ?
                  ORDER BY orden ASC, id ASC
                  LIMIT 1`,
                automatizacion,
            ),
        ][0]

        if (!fila?.texto?.trim()) return null
        return conBotones(sql, fila, cliente)
    } catch (err) {
        console.error(`[flujos] no se pudo leer la primera caja de ${automatizacion}: ${err}`)
        return null
    }
}

/**
 * La caja a la que lleva un botón.
 *
 * El `payload` de un botón es `b<id>`, el identificador del botón en la
 * base. Se guarda así y no con el texto del botón por un motivo
 * concreto: **el texto se puede cambiar desde el panel**, y si el enlace
 * dependiera de él, editar un botón rompería las conversaciones que
 * estuvieran a medias.
 */
export function cajaDelBoton(sql: SqlStorage, payload: string, cliente: string): Caja | null {
    const id = Number(payload.replace(/^b/, ''))
    if (!Number.isInteger(id) || id <= 0) return null

    try {
        const fila = [
            ...sql.exec<FilaDeCaja>(
                `SELECT n.id, n.texto, n.siguiente
                   FROM botones b
                   JOIN nodos n ON n.id = b.destino
                  WHERE b.id = ?`,
                id,
            ),
        ][0]

        if (!fila?.texto?.trim()) return null
        return conBotones(sql, fila, cliente)
    } catch (err) {
        console.error(`[flujos] no se pudo seguir el boton ${payload}: ${err}`)
        return null
    }
}

/** Una caja por su identificador, para encadenar con `siguiente`. */
export function cajaPorId(sql: SqlStorage, id: number, cliente: string): Caja | null {
    try {
        const fila = [
            ...sql.exec<FilaDeCaja>(`SELECT id, texto, siguiente FROM nodos WHERE id = ?`, id),
        ][0]

        if (!fila?.texto?.trim()) return null
        return conBotones(sql, fila, cliente)
    } catch (err) {
        console.error(`[flujos] no se pudo leer la caja ${id}: ${err}`)
        return null
    }
}

/**
 * Le pega los botones a una caja.
 *
 * ── Los dos tipos, y por qué se filtran ────────────────────────────
 *
 * `ir` lleva a otra caja y `enlace` abre una dirección. Se dejan fuera
 * los que **no tienen a dónde ir**: un botón de enlace sin URL o uno de
 * ir sin destino hace que Meta rechace el mensaje **entero**, así que
 * perder ese botón salva el texto y los demás.
 *
 * Cuando se cae uno se dice en el registro, porque es un error de cómo
 * está montado el flujo y se arregla en el panel, no aquí.
 */
function conBotones(sql: SqlStorage, fila: FilaDeCaja, cliente: string): Caja {
    const botones: Boton[] = []
    try {
        const filas = [
            ...sql.exec<{
                id: number
                texto: string
                tipo: string
                destino: number | null
                url: string | null
            }>(
                `SELECT id, texto, tipo, destino, url
                   FROM botones
                  WHERE nodo_id = ?
                  ORDER BY orden ASC, id ASC`,
                fila.id,
            ),
        ]

        for (const b of filas) {
            if (b.tipo === 'enlace') {
                if (b.url) botones.push({ titulo: b.texto, url: b.url })
                else console.warn(`[flujos] el boton ${b.id} («${b.texto}») no tiene direccion`)
            } else if (b.destino) {
                botones.push({ titulo: b.texto, payload: `b${b.id}` })
            } else {
                console.warn(`[flujos] el boton ${b.id} («${b.texto}») no lleva a ninguna caja`)
            }
        }
    } catch (err) {
        // Sin botones se manda el texto solo, que es mejor que no mandar
        // nada: la persona recibe la información igual.
        console.error(`[flujos] no se pudieron leer los botones de la caja ${fila.id}: ${err}`)
    }

    return {
        id: fila.id,
        texto: fila.texto!.trim(),
        siguiente: fila.siguiente,
        botones: ajustarBotones(botones, cliente),
    }
}
