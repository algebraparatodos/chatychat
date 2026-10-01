/**
 * La puerta de servicio: mirar y sembrar los datos de un cliente.
 *
 * ── Por qué existe ─────────────────────────────────────────────────
 *
 * Con D1 se podía abrir una consola y mirar la base de cualquier cliente
 * con `wrangler d1 execute`. Eso era lo mejor que tenía D1, y es lo
 * único que se pierde al pasar a Durable Objects: el almacenamiento de
 * un objeto **no se alcanza desde fuera**, por diseño.
 *
 * Perder eso del todo sería un mal negocio. Todo el trabajo de estos
 * días —ver por qué un mensaje no salió, contar cuántos eventos hay,
 * comprobar que una migración no perdió nada— se hizo mirando datos. Así
 * que se devuelve por aquí, con límites estrechos y escritos.
 *
 * ── Los límites, que no son negociables ────────────────────────────
 *
 * 1. **Hace falta una llave, y la llave tiene dueño.** Cada persona
 *    tiene la suya, en la tabla `llaves`, y cada uso deja una fila en
 *    `registro_admin`. El porqué está en `src/base.ts`, y en una línea
 *    es que «alguien con la llave» no es una respuesta cuando un cliente
 *    pregunta quién ha leído sus conversaciones.
 * 2. **Leer es sólo `SELECT`**, una sentencia, con tope de filas. Lo
 *    comprueba el propio objeto, que es la última puerta.
 * 3. **Sembrar sólo funciona sobre un objeto vacío**, salvo que se pida
 *    `?vaciar=si` a mano. Un cliente con datos dentro no se puede pisar
 *    por accidente, y la llamada que sí borra queda escrita en el
 *    registro como lo que es.
 *
 * ── Y por qué ahora sí podría llevar a una pantalla, pero no la lleva ─
 *
 * Antes aquí decía que una pantalla invitaría a usar esto a diario, y
 * que lo que se usa a diario acaba necesitando permisos finos y registro
 * de quién miró qué. Eso último ya está. Lo que sigue sin estar es el
 * motivo para que el cliente lo vea: se decidió el 24/09/2026 que el
 * registro se le **entrega cuando lo pida**, y no se le pone en el panel
 * para que lo mire suelto, porque un cliente leyendo «consultar» sobre
 * sus datos saca una conclusión que el registro no dice.
 */

import { apuntarMirada, llaveDeLaPuerta, quienMiro, type Env } from './base'

const json = { 'content-type': 'application/json; charset=utf-8' }

/** La huella de una llave: lo que se guarda, nunca la llave. */
async function huellaDe(llave: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(llave))
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Quién viene, si viene alguien.
 *
 * Los tres casos son distintos a proposito, porque merecen tratos
 * distintos:
 *
 *   `nadie`  no trae cabecera. Un rastreo cualquiera. Ni se apunta: si
 *            se apuntara, cualquiera podría llenar la tabla desde fuera.
 *   `mala`   trae una llave que no vale. **Eso sí se apunta**, porque es
 *            lo único que distingue a alguien probando llaves de nadie.
 *   `buena`  trae la de una persona, y se sabe quién.
 */
type Quien =
    | { tipo: 'nadie' }
    | { tipo: 'mala'; huella: string }
    | { tipo: 'buena'; nombre: string }

async function quienEntra(peticion: Request, env: Env): Promise<Quien> {
    const dado = (peticion.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!dado) return { tipo: 'nadie' }

    const huella = await huellaDe(dado)
    const llave = await llaveDeLaPuerta(huella, env)
    if (llave) return { tipo: 'buena', nombre: llave.nombre }

    // ── La llave compartida de antes ───────────────────────────────
    //
    // Sigue valiendo para que las herramientas no dejen de funcionar el
    // día que esto se despliega. Pero entra con nombre propio en el
    // registro, `compartida`, y ese nombre es el aviso: mientras aparezca
    // en el registro, la pregunta «quién miró» tiene una respuesta peor
    // de la que podría tener.
    //
    // Se quita borrando el secreto del Worker, cuando cada persona tenga
    // la suya.
    const esperado = env.ADMIN_TOKEN
    if (esperado) {
        const a = new TextEncoder().encode(dado)
        const b = new TextEncoder().encode(esperado)
        if (a.length === b.length && crypto.subtle.timingSafeEqual(a, b)) {
            return { tipo: 'buena', nombre: 'compartida' }
        }
    }

    return { tipo: 'mala', huella: huella.slice(0, 12) }
}

/** Lo que manda una herramienta para sembrar un objeto. */
export type Siembra = Record<string, Record<string, unknown>[]>

export async function puertaDeServicio(
    peticion: Request,
    url: URL,
    env: Env,
): Promise<Response | null> {
    if (!url.pathname.startsWith('/admin/')) return null

    // 404 y no 403 en todo lo que rechaza, a proposito: a quien no trae
    // la llave buena no se le confirma que esta puerta exista.
    const no = () => new Response('no\n', { status: 404 })

    const quien = await quienEntra(peticion, env)
    if (quien.tipo === 'nadie') return no()
    if (quien.tipo === 'mala') {
        await apuntarMirada(
            {
                llave: `desconocida:${quien.huella}`,
                cliente: url.searchParams.get('cliente'),
                accion: url.pathname.replace('/admin/', ''),
                detalle: null,
                resultado: 'rechazada',
            },
            env,
        )
        return no()
    }

    const clave = url.searchParams.get('cliente')

    /**
     * Apuntar y contestar, siempre en este orden y en un solo sitio.
     *
     * Separar el «hacer» del «apuntar» en cada rama era lo que dejaría
     * salidas sin registrar: basta un `return` temprano en una rama nueva
     * para que esa acción no aparezca nunca en el registro, y eso no da
     * ningún error. Con un único punto de salida, una rama nueva no se
     * puede olvidar de apuntar porque no tiene por dónde.
     */
    const contestar = async (
        accion: string,
        detalle: string | null,
        cuerpo: unknown,
        estado = 200,
    ): Promise<Response> => {
        await apuntarMirada(
            {
                llave: quien.nombre,
                cliente: clave,
                accion,
                detalle,
                resultado: estado === 200 ? 'bien' : `fallo ${estado}`,
            },
            env,
        )
        return new Response(JSON.stringify(cuerpo), { status: estado, headers: json })
    }

    // ── Quién miró ─────────────────────────────────────────────────
    //
    // Va antes de exigir `?cliente=`, porque sin cliente es la vista de
    // todo, que es la que se usa para revisar la propia puerta.
    if (url.pathname === '/admin/registro' && peticion.method === 'GET') {
        const limite = Number(url.searchParams.get('limite') ?? 100)
        const filas = await quienMiro(clave, Number.isFinite(limite) ? limite : 100, env)
        return contestar('registro', clave ? `de ${clave}` : 'de todos', { filas })
    }

    if (!clave) {
        return contestar('sin-cliente', null, { error: 'falta ?cliente=' }, 400)
    }
    const objeto = env.CLIENTES.get(env.CLIENTES.idFromName(clave))

    if (url.pathname === '/admin/consultar' && peticion.method === 'POST') {
        const { sql, limite } = (await peticion.json().catch(() => ({}))) as {
            sql?: string
            limite?: number
        }
        if (!sql) {
            return contestar('consultar', null, { error: 'falta sql' }, 400)
        }
        const r = await objeto.consultar(sql, limite ?? 200)
        return contestar('consultar', sql, r, r.error ? 400 : 200)
    }

    if (url.pathname === '/admin/sembrar' && peticion.method === 'POST') {
        const datos = (await peticion.json().catch(() => null)) as Siembra | null
        if (!datos) {
            return contestar('sembrar', null, { error: 'el cuerpo no es json' }, 400)
        }
        // Vaciar antes va en la URL y no en el cuerpo: asi se distingue en
        // el registro cuál fue la llamada destructiva, que es la que
        // alguien va a querer buscar si algo desaparece.
        const vaciar = url.searchParams.get('vaciar') === 'si'
        const r = await objeto.sembrar(datos, { vaciar })
        const resumen = Object.entries(datos)
            .map(([tabla, filas]) => `${tabla}:${filas.length}`)
            .join(' ')
        return contestar(vaciar ? 'sembrar-vaciando' : 'sembrar', resumen, r, r.error ? 400 : 200)
    }

    if (url.pathname === '/admin/estado' && peticion.method === 'GET') {
        return contestar('estado', null, await objeto.estado())
    }

    return contestar('desconocida', url.pathname, { error: 'no existe' }, 404)
}
