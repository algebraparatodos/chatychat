/**
 * Saca el JSON de lo que imprime wrangler.
 *
 * ── Por qué no vale `indexOf('[')` ─────────────────────────────────
 *
 * Porque wrangler adorna la salida antes del JSON, y esos adornos
 * llevan corchetes: los códigos de color de la terminal empiezan por
 * `\x1b[`, y las líneas de aviso llevan `[WARNING]` y compañía. Cortar
 * por el primer corchete deja dentro basura, o corta por la mitad, y
 * entonces `JSON.parse` devuelve algo parcial **sin lanzar ningún
 * error**.
 *
 * Eso costó un rato: una herramienta leía una fila donde había dos, y
 * como la que leía venía sin fecha la daba por caducada. Todo parecía
 * funcionar y el número estaba mal.
 *
 * Aquí se busca el corchete que abre **al principio de una línea**, que
 * es donde wrangler pone el JSON de verdad.
 */
export function jsonDeWrangler(salida) {
    const m = String(salida).match(/^\[/m)
    if (!m || m.index === undefined) {
        throw new Error(`no encontre JSON en la salida de wrangler:\n${salida}`)
    }
    return JSON.parse(salida.slice(m.index))
}

/** Las filas del primer resultado, que es lo que se quiere casi siempre. */
export function filasDeWrangler(salida) {
    return jsonDeWrangler(salida)[0]?.results ?? []
}

/**
 * ⚠️ LEER CON `--command`, ESCRIBIR CON `--file`.
 *
 * `wrangler d1 execute --file=...` **no devuelve las filas de un
 * SELECT**: devuelve un resumen con «Total queries executed» y «Rows
 * read». Así que una lectura por archivo parece funcionar, devuelve una
 * fila, y esa fila no tiene ninguna de las columnas que se pidieron.
 *
 * Eso engaña mucho: no falla, no avisa, y el código de después trabaja
 * con una fila que no es. Aquí costó un rato entender por qué una
 * herramienta veía un comentario donde había dos, y por qué lo daba por
 * caducado (no tenía fecha, claro).
 *
 * Y al revés: `--command` se rompe con SQL de varias líneas en Windows,
 * al pasar por el shell. Así que:
 *
 *     leer   ->  --command, en una sola línea
 *     escribir -> --file
 */
export function enUnaLinea(sql) {
    return String(sql).replace(/\s+/g, ' ').trim()
}