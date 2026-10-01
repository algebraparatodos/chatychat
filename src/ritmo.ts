/**
 * El tope de envíos por hora, que es de la cuenta del cliente.
 *
 * ── Por qué hace falta ─────────────────────────────────────────────
 *
 * Meta permite **750 llamadas por hora y por cuenta**. Un cliente con un
 * reel que se vuelve viral lo agota en minutos, y a partir de ahí **todos
 * sus envíos fallan**. Sin contar, el bot seguiría intentándolo y cada
 * intento sería una respuesta perdida delante de alguien que preguntó un
 * precio.
 *
 * Lo peor de ese fallo es cuándo pasa: justo el día que al cliente le fue
 * bien. Es el día en que menos se le puede explicar que el bot dejó de
 * contestar.
 *
 * ── Se cuentan llamadas, no respuestas ─────────────────────────────
 *
 * Contestar un comentario son **dos** llamadas: la respuesta privada y el
 * aviso público. Contar respuestas dejaría este número a la mitad de lo
 * que Meta ve, y se rozaría el tope sin que nada lo dijera.
 *
 * ── Y no se descarta: se aparta para luego ─────────────────────────
 *
 * Una respuesta privada tiene **7 días** de plazo, no 24 horas. Así que
 * lo que no cabe en esta hora cabe perfectamente en la siguiente, y
 * tirarlo sería tirar justo los mensajes de la hora en que más gente
 * escribió.
 */

/**
 * El tope propio, por debajo del de Meta.
 *
 * Meta corta en 750. Aquí se corta en 700 porque **el tope es de la
 * cuenta entera**, no sólo del bot: el cliente puede estar usando otras
 * herramientas sobre su misma cuenta, y ésas también gastan. Cincuenta
 * llamadas de colchón cubren eso y cuestan poco, un 6% de la hora.
 *
 * Antes había otro motivo —dos peticiones podían leer el contador a la
 * vez y pisarse— que **con Durable Objects ya no existe**: mientras
 * corre un método, nadie más toca esta base. El colchón se queda por lo
 * primero, que sigue siendo cierto.
 */
const TOPE = 700

/** La hora actual en UTC, como 'YYYY-MM-DD HH'. */
function horaDeAhora(): string {
    return new Date().toISOString().slice(0, 13).replace('T', ' ')
}

/**
 * Pide permiso para hacer `cuantas` llamadas, y lo apunta si lo da.
 *
 * Devuelve `true` si caben. Ante un fallo devuelve `true` también, y es
 * deliberado: si no se puede contar, es mejor mandar y que Meta corte
 * que callarse por un problema nuestro. El tope de Meta sigue ahí como
 * última red; este contador sólo existe para no llegar a él.
 *
 * ── Ya no es `async`, y eso no es cosmético ────────────────────────
 *
 * `sql.exec()` devuelve el resultado, no una promesa. Leer el contador y
 * escribirlo es ahora **una sola operación sin nada en medio**: no hay
 * un `await` entre las dos por el que se pueda colar otra petición y
 * dejar el número mal contado.
 */
export function cabenEstaHora(sql: SqlStorage, cuantas: number, cliente: string): boolean {
    const hora = horaDeAhora()
    try {
        const yaHechas =
            [...sql.exec<{ llamadas: number }>(`SELECT llamadas FROM ritmo WHERE hora = ?`, hora)][0]
                ?.llamadas ?? 0

        if (yaHechas + cuantas > TOPE) {
            // Se dice una vez por envío rechazado y no una por hora: son
            // pocos y cada uno es un mensaje que alguien no recibió
            // cuando lo esperaba.
            console.warn(
                `[ritmo] «${cliente}» lleva ${yaHechas} llamadas esta hora, ` +
                    `no caben ${cuantas} mas. Se aparta para luego.`,
            )
            return false
        }

        sql.exec(
            `INSERT INTO ritmo (hora, llamadas) VALUES (?1, ?2)
             ON CONFLICT(hora) DO UPDATE SET llamadas = llamadas + ?2`,
            hora,
            cuantas,
        )

        // Las horas pasadas ya no sirven para nada y no hace falta
        // limpiarlas aparte: se van en el mismo viaje.
        if (yaHechas === 0) {
            sql.exec(`DELETE FROM ritmo WHERE hora < ?`, hora)
        }
        return true
    } catch (err) {
        console.error(`[ritmo] no se pudo contar para «${cliente}», se manda igual: ${err}`)
        return true
    }
}

/** Cuántas llamadas lleva esta hora. Para el panel. */
export function llamadasDeEstaHora(sql: SqlStorage): number {
    try {
        return (
            [
                ...sql.exec<{ llamadas: number }>(
                    `SELECT llamadas FROM ritmo WHERE hora = ?`,
                    horaDeAhora(),
                ),
            ][0]?.llamadas ?? 0
        )
    } catch {
        return 0
    }
}

/** El tope propio, para que el panel pueda enseñar cuánto queda. */
export const TOPE_POR_HORA = TOPE
