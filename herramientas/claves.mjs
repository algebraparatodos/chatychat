/**
 * Las credenciales, leidas de los dos `.claves.env`.
 *
 * -- Por que son dos ------------------------------------------------
 *
 * El de la carpeta de arriba tiene lo que comparten todos los
 * proyectos, y ahi vive el token de Cloudflare. El del proyecto tiene lo
 * suyo: la app de Meta, el token de verificacion del webhook.
 *
 * Hay que cargar **los dos**. Cargar solo uno es el fallo tipico, y el
 * sintoma enganna: wrangler dice que no estas autenticado, que suena a
 * problema de sesion y no a un archivo que no se leyo.
 *
 * Ninguno de los dos se sube: los dos estan en `.gitignore`.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Los dos archivos, de menos a mas especifico: el del proyecto gana. */
const ARCHIVOS = [join(RAIZ, '..', '.claves.env'), join(RAIZ, '.claves.env')]

function leer(ruta) {
    let texto
    try {
        texto = readFileSync(ruta, 'utf8')
    } catch {
        return {}
    }
    const claves = {}
    for (const linea of texto.split(/\r?\n/)) {
        const t = linea.trim()
        if (!t || t.startsWith('#') || !t.includes('=')) continue
        const [k, ...v] = t.split('=')
        claves[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '')
    }
    return claves
}

/** Todas las claves de los dos archivos, con las del proyecto encima. */
export const claves = Object.assign({}, ...ARCHIVOS.map(leer))

/**
 * El entorno para lanzar wrangler.
 *
 * Se devuelve en vez de tocar `process.env` para que quede a la vista en
 * cada llamada con que credenciales se esta corriendo. Un script que
 * despliega no deberia autenticarse por un efecto lateral que paso hace
 * cien lineas.
 */
export function entornoCloudflare() {
    const token = claves.CLOUDFLARE_API_TOKEN
    if (!token) {
        console.error(
            'No encuentro CLOUDFLARE_API_TOKEN.\n\n' +
                'Tiene que estar en el .claves.env de la carpeta de arriba,\n' +
                'que es el de arriba de esta carpeta.',
        )
        process.exit(1)
    }
    return { ...process.env, CLOUDFLARE_API_TOKEN: token }
}

/**
 * La llave de la puerta de servicio, `/admin/*`.
 *
 * ── Por qué el entorno gana al archivo, al contrario que todo lo demás ─
 *
 * Porque desde el 24/09/2026 **la llave es de una persona, no del
 * proyecto**, y el `.claves.env` es del proyecto. Si cada uno guardara la
 * suya ahí, la última en escribirse sería la de todos: los accesos de
 * una persona quedarían apuntados a nombre de quien escribió el archivo, y el
 * registro diría algo falso justo en la columna por la que existe.
 *
 * Así que quien tenga llave propia la exporta en su terminal:
 *
 *     ADMIN_TOKEN=su-llave node herramientas/lo-que-sea.mjs
 *
 * y el archivo se queda con la compartida, que es la que sigue valiendo
 * mientras el secreto `ADMIN_TOKEN` esté puesto en el Worker.
 *
 * Las llaves se crean y se revocan con `llaves-de-servicio.mjs`, y quién
 * miró qué se lee con `quien-miro.mjs`.
 */
export function llaveDeServicio() {
    const llave = process.env.ADMIN_TOKEN || claves.ADMIN_TOKEN
    if (!llave) {
        console.error(
            'No encuentro ADMIN_TOKEN.\n\n' +
                'O lo exportas en la terminal, si tienes llave propia:\n' +
                '  ADMIN_TOKEN=tu-llave node herramientas/...\n\n' +
                'O esta en el .claves.env del proyecto, que es la compartida.\n' +
                'Las llaves propias se crean con:\n' +
                '  node herramientas/llaves-de-servicio.mjs crear <nombre>\n',
        )
        process.exit(1)
    }
    return llave
}
