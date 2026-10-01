/**
 * Qué automatización le toca a lo que acaba de llegar.
 *
 * ── La base llega por parámetro, siempre ───────────────────────────
 *
 * Como en todo el proyecto. Este archivo no sabe de qué cliente es la
 * base que recibe ni de dónde salió, y eso es lo que permite cambiar de
 * D1 a Durable Objects tocando sólo `base.ts`.
 */

/** Lo que hace falta saber para contestar. */
export type Elegida = {
    automatizacion: number
    nombre: string
    respuesta: string
    avisoPublico: string | null
    /** Cuál de sus disparadores fue el que la despertó. */
    disparador: number
}

/**
 * Busca el disparador que coincide, o `null` si no hay ninguno.
 *
 * ── Las cuatro condiciones, y por qué cada una ─────────────────────
 *
 * 1. **La automatización está encendida y no archivada.** Lo segundo se
 *    olvida y se paga caro: una archivada puede ganarle a una viva y
 *    contestar en su lugar, con un texto que alguien retiró a propósito.
 *
 * 2. **El disparador está activo** y es del tipo que corresponde. Un
 *    comentario y una respuesta a una historia son cosas distintas
 *    aunque las dos traigan texto.
 *
 * 3. **El objetivo coincide.** Vacío quiere decir «en cualquiera»; con un
 *    id puesto, sólo en esa publicación o esa historia. Respetarlo es lo
 *    que impide que una palabra genérica como «info» conteste en
 *    publicaciones que no tienen nada que ver.
 *
 * 4. **Alguna palabra aparece en el texto.** Sin palabras, cualquier cosa
 *    vale, que es el caso normal en una historia: quien contesta a una
 *    historia ya dijo que le interesa.
 *
 * ── Por qué se compara aquí y no en SQL ────────────────────────────
 *
 * Porque SQLite no quita acentos, y la gente escribe «Reservá» y
 * «reservar» con la misma intención. Son pocas filas: traerlas y
 * compararlas en memoria sale más barato que depender de la intercalación
 * de la base.
 *
 * ── El orden, que decide quién contesta ────────────────────────────
 *
 * Gana la prioridad más alta y, a igualdad, **el disparador más
 * concreto**: el que está atado a una publicación le gana al que escucha
 * en todas. Es lo sensato cuando dos coinciden, que pasa más de lo que
 * parece.
 */
export function buscarDisparador(
    sql: SqlStorage,
    texto: string | undefined,
    tipo: 'comentario' | 'historia' | 'mensaje',
    objetivo: string | undefined,
): Elegida | null {
    const filas = [
        ...sql.exec<{
            id: number
            nombre: string
            respuesta: string
            aviso_publico: string | null
            disparador: number
            palabras: string
        }>(
            `SELECT a.id, a.nombre, a.respuesta, a.aviso_publico,
                    d.id AS disparador, d.palabras
               FROM disparadores d
               JOIN automatizaciones a ON a.id = d.automatizacion_id
              WHERE a.activa = 1
                AND a.archivada = 0
                AND d.activo = 1
                AND d.tipo = ?1
                AND (d.objetivo IS NULL OR d.objetivo = ?2)
              ORDER BY a.prioridad DESC,
                       CASE WHEN d.objetivo IS NULL THEN 1 ELSE 0 END ASC,
                       a.id ASC`,
            tipo,
            objetivo ?? null,
        ),
    ]

    const limpio = normalizar(texto ?? '')

    for (const fila of filas) {
        const palabras = (fila.palabras ?? '').split('|').map(normalizar).filter(Boolean)
        const coincide = palabras.length === 0 || palabras.some((p) => limpio.includes(p))
        if (!coincide) continue

        return {
            automatizacion: fila.id,
            nombre: fila.nombre,
            respuesta: fila.respuesta,
            avisoPublico: fila.aviso_publico,
            disparador: fila.disparador,
        }
    }
    return null
}

/** Minúsculas, sin acentos y con los espacios apretados. */
export function normalizar(t: string): string {
    return t
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Suma uno a los contadores de la automatización y del disparador.
 *
 * ── Cuenta aunque el envío falle, a propósito ──────────────────────
 *
 * «Cuántas veces se disparó» y «cuántas veces se entregó» son dos
 * preguntas distintas, y la segunda ya se responde mirando `eventos`, que
 * guarda el error de cada envío. Si el contador sólo sumara los aciertos,
 * **un flujo roto parecería un flujo que nadie usa**, que es justo lo
 * contrario de lo que hay que ver.
 *
 * Nunca lanza: no poder llevar la cuenta no es motivo para dejar de
 * contestar.
 */
export function contarDisparo(sql: SqlStorage, e: Elegida): void {
    try {
        // Antes esto era un `batch`, que en D1 era la unica forma de que
        // las dos sumas fueran juntas. Aqui no hace falta: un metodo del
        // objeto corre entero sin que nadie se cuele en medio, asi que
        // las dos lineas ya son indivisibles.
        sql.exec(`UPDATE automatizaciones SET disparos = disparos + 1 WHERE id = ?`, e.automatizacion)
        sql.exec(`UPDATE disparadores SET disparos = disparos + 1 WHERE id = ?`, e.disparador)
    } catch (err) {
        console.error(`[base] no se pudo contar el disparo de ${e.automatizacion}: ${err}`)
    }
}
