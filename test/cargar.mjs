/**
 * Lo que hace falta para correr el código del Worker con `node --test`.
 *
 * Node ejecuta TypeScript quitando los tipos, sin compilar. Quedan tres
 * diferencias con el runtime de Cloudflare, y se resuelven aquí y no
 * tocando el código de `src/`:
 *
 *   1. Los imports de `src/` van sin extensión (`'./ventanas'`), como los
 *      escribe el empaquetador de wrangler. Node necesita la extensión:
 *      se prueba con `.ts`.
 *   2. `cloudflare:workers` no existe fuera del runtime. Las pruebas no
 *      montan un Durable Object, sólo hace falta que el módulo cargue.
 *   3. `crypto.subtle.timingSafeEqual` es una extensión de Cloudflare.
 *
 * El registro del Worker se calla para que la salida sea la de las
 * pruebas. `MOSTRAR_REGISTRO=1 npm test` lo deja ver.
 */

import { registerHooks } from 'node:module'
import { timingSafeEqual } from 'node:crypto'

const SIN_EXTENSION = /^\.{1,2}\/.*\/?[^./]+$/

registerHooks({
    resolve(especificador, contexto, siguiente) {
        if (especificador === 'cloudflare:workers') {
            return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } }', shortCircuit: true }
        }
        if (SIN_EXTENSION.test(especificador) && contexto.parentURL?.endsWith('.ts')) {
            try {
                return siguiente(`${especificador}.ts`, contexto)
            } catch {
                // Si no hay un .ts con ese nombre, que lo resuelva Node.
            }
        }
        return siguiente(especificador, contexto)
    },
})

if (!crypto.subtle.timingSafeEqual) {
    crypto.subtle.timingSafeEqual = (a, b) =>
        timingSafeEqual(
            new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
            new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
        )
}

if (!process.env.MOSTRAR_REGISTRO) {
    for (const nivel of ['log', 'warn', 'error']) console[nivel] = () => {}
}
