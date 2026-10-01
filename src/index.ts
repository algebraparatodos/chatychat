/**
 * El receptor de webhooks de la plataforma.
 *
 * ── Qué cambia respecto de un bot de una sola cuenta ───────────────
 *
 * Una cosa, y lo cambia todo: **el mismo POST puede ser de cualquier
 * cliente**. Meta manda todos los eventos de todas las cuentas
 * conectadas a la app a esta única dirección, y lo único que dice de
 * quién es cada uno es `entry[].id`, el identificador de la cuenta de
 * Instagram.
 *
 * Así que lo primero de todo es averiguar de quién es, y a partir de ahí
 * trabajar **sólo dentro de su base**. El enrutado vive en `base.ts`, que
 * es el único archivo que sabe de dónde sale una base; aquí no hay ni un
 * `env.ALGO.prepare(...)`, y no es casualidad.
 *
 * ── Un cliente roto no puede tumbar a los demás ────────────────────
 *
 * Es la regla que gobierna el manejo de errores de este archivo. Un
 * mismo POST puede traer eventos de varias cuentas, y siempre se
 * devuelve 200: si se contestara con un error, Meta reintentaría el lote
 * entero, incluidos los eventos que ya se atendieron bien.
 */

import { puertaDeServicio } from './admin'
import type { Entrada, EventoDeMeta } from './atender'
import { clienteDeLaCuenta, credencialDe, type Env, type Ficha } from './base'
import { empezarConexion, volverDeInstagram } from './conectar'
import { empezarConexionFacebook, volverDeFacebook } from './conectar-facebook'
import { avisoDeDesconexion, estadoDeBorrado, solicitudDeBorrado } from './privacidad'
import { pasadaDiaria } from './salud'

// El objeto de cliente se exporta desde aqui porque Cloudflare busca las
// clases de Durable Object en el modulo principal del Worker.
export { Cliente } from './cliente'

const textoPlano = { 'content-type': 'text/plain; charset=utf-8' }

export default {
    async fetch(peticion: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(peticion.url)

        if (url.pathname === '/webhook' && peticion.method === 'GET') {
            return verificarSuscripcion(url, env)
        }
        if (url.pathname === '/webhook' && peticion.method === 'POST') {
            return recibirEvento(peticion, env, ctx)
        }
        // Lo que abre el cliente para conectar su cuenta. La clave va en
        // la ruta y no en un parámetro porque es un enlace que se le
        // manda por mensaje: cuanto más corto y más limpio, menos gente
        // lo rompe al copiarlo.
        if (url.pathname.startsWith('/conectar/') && peticion.method === 'GET') {
            return empezarConexion(url.pathname.slice('/conectar/'.length), url, env)
        }
        // El mismo enlace, pero por el camino de Facebook. Se llega aqui
        // cuando ya se sabe que esa cuenta tiene Pagina: o porque fallo
        // el intento por Instagram y quedo anotado, o porque se le mando
        // directo desde el panel.
        if (url.pathname.startsWith('/conectar-facebook/') && peticion.method === 'GET') {
            return empezarConexionFacebook(
                url.pathname.slice('/conectar-facebook/'.length),
                url,
                env,
            )
        }
        if (url.pathname === '/oauth/facebook' && peticion.method === 'GET') {
            return volverDeFacebook(url, env)
        }
        if (url.pathname === '/oauth/instagram' && peticion.method === 'GET') {
            return volverDeInstagram(url, env)
        }
        // Lo que Meta llama cuando alguien se va o pide que le borren
        // sus datos. Las dos son POST con un sobre firmado, y las dos
        // son requisito para que revisen la app.
        if (url.pathname === '/oauth/cancelada' && peticion.method === 'POST') {
            return avisoDeDesconexion(peticion, env)
        }
        if (url.pathname === '/datos/eliminar' && peticion.method === 'POST') {
            return solicitudDeBorrado(peticion, env)
        }
        // Y la pagina que consulta la persona con su codigo.
        if (url.pathname === '/datos/estado' && peticion.method === 'GET') {
            return estadoDeBorrado(url, env)
        }
        // La puerta de servicio: mirar y sembrar los datos de un
        // cliente. Pide su propia llave y devuelve 404 a quien no la
        // trae, asi que va antes de cualquier otra ruta y no estorba.
        const servicio = await puertaDeServicio(peticion, url, env)
        if (servicio) return servicio

        if (url.pathname === '/salud') {
            return new Response('vivo\n', { headers: textoPlano })
        }
        return new Response('no hay nada aca\n', { status: 404, headers: textoPlano })
    },

    /**
     * Lo que corre solo, cada cinco minutos: lo que hay que mandar mas
     * tarde.
     *
     * Un Worker no puede esperar 23 horas, asi que los seguimientos se
     * apuntan en la tabla `pendientes` de cada cliente y esto los barre.
     *
     * -- Recorre TODOS los clientes, y eso tiene un limite -----------
     *
     * Un cron no viene de un webhook: no hay una cuenta de la que
     * partir. Hay que mirar cliente por cliente, y eso crece con la
     * cartera. Hoy sobra de largo; con muchos clientes habra que
     * trocear, porque un Worker tiene 1.000 consultas por invocacion y
     * 30 segundos de CPU.
     *
     * Cuando llegue ese dia, el sitio de arreglarlo es este, y la forma
     * es repartir los clientes por minuto en vez de barrerlos todos en
     * la misma pasada.
     */
    async scheduled(_evento: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
        // Ya no se barren los pendientes de nadie: cada cliente se
        // despierta solo con su alarma, a la hora exacta. Lo unico que
        // queda aqui es lo que de verdad es de plataforma.
        //
        // Una vez al dia, renovar los tokens y revisar que a cada cliente
        // le siga llegando. Se llama en cada pasada y ella misma decide
        // si toca: asi no hace falta un segundo cron, que seria otra cosa
        // que puede estar mal configurada sin que se note.
        ctx.waitUntil(pasadaDiaria(env))
    },
} satisfies ExportedHandler<Env>


/**
 * El apretón de manos del panel de Meta, una sola vez al configurar.
 *
 * Meta llama con tres parámetros y espera `hub.challenge` en crudo: sin
 * comillas, sin JSON y sin salto de línea de más.
 */
function verificarSuscripcion(url: URL, env: Env): Response {
    const modo = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const desafio = url.searchParams.get('hub.challenge')

    if (modo !== 'subscribe' || !desafio) {
        return new Response('faltan parametros\n', { status: 400, headers: textoPlano })
    }
    if (!env.META_VERIFY_TOKEN || token !== env.META_VERIFY_TOKEN) {
        // Sin detalles: a quien prueba tokens no se le dice si falló por
        // el token o por otra cosa.
        console.warn('[webhook] verificacion rechazada: el verify token no coincide')
        return new Response('no\n', { status: 403, headers: textoPlano })
    }
    console.log('[webhook] verificacion superada')
    return new Response(desafio, { status: 200, headers: textoPlano })
}

async function recibirEvento(
    peticion: Request,
    env: Env,
    ctx: ExecutionContext,
): Promise<Response> {
    // El cuerpo EN CRUDO, y se firma eso mismo. Parsear el JSON y volver
    // a serializarlo casi nunca da los mismos bytes, y entonces la firma
    // no cuadra nunca.
    const crudo = await peticion.text()
    const firma = peticion.headers.get('x-hub-signature-256')

    // Se prueban **los tres secretos**, y no uno.
    //
    // Un caso de uso de Instagram trae, además de la app de Meta, una
    // app de Instagram propia con su identificador y su clave secreta
    // aparte. Las dos pueden acabar apuntando a este mismo webhook y
    // **cada una firma con la suya**.
    //
    // Esto ya pasó, y costó horas: el 20/09/2026, en el bot de una sola
    // cuenta del que salió este producto, los clics en los botones no llegaban nunca y el registro
    // repetía «la firma no valida» intercalado con eventos que sí
    // pasaban. Validar contra un solo secreto tiraba la mitad de lo que
    // llegaba, y entre eso estaban los clics.
    //
    // Aceptar las dos es correcto porque **las dos son nuestras**. Lo
    // que no se puede es aceptar sin firma: quien supiera la URL podría
    // hacer que el bot le escriba a quien quisiera.
    const firmadaPor = await quienFirmo(crudo, firma, env)
    if (!firmadaPor) {
        // Se dice si venía firma o no, y no sólo que se descartó. Un
        // «descartado» a secas es lo que esconde este problema: no
        // distingue «me mandaron basura» de «tengo mal un secreto».
        console.warn(
            `[webhook] evento descartado: ${
                firma ? 'la firma no valida con ninguno de los secretos' : 'venia sin firma'
            }`,
        )
        return new Response('no\n', { status: 403, headers: textoPlano })
    }

    let cuerpo: EventoDeMeta
    try {
        cuerpo = JSON.parse(crudo)
    } catch {
        // Firma buena y JSON roto no es algo que vaya a arreglarse
        // reintentando, así que 200 y a otra cosa.
        console.error('[webhook] cuerpo con firma valida que no es JSON')
        return new Response('ok\n', { headers: textoPlano })
    }

    // Se contesta ya y el trabajo se hace después: Meta reintenta si no
    // recibe un 200 rápido, y un reintento duplica lo que estamos
    // atendiendo en este mismo momento.
    ctx.waitUntil(atenderLote(cuerpo, env))
    return new Response('ok\n', { headers: textoPlano })
}

/** Un POST puede traer entradas de varias cuentas, o sea de varios clientes. */
async function atenderLote(cuerpo: EventoDeMeta, env: Env): Promise<void> {
    for (const entrada of cuerpo.entry ?? []) {
        const cuentaIg = entrada.id
        if (!cuentaIg) continue

        let cliente: Ficha | null = null
        try {
            cliente = await clienteDeLaCuenta(cuentaIg, env)
        } catch (err) {
            console.error(`[control] no se pudo buscar el cliente de ${cuentaIg}: ${err}`)
            continue
        }

        if (!cliente) {
            // Pasa de verdad y no siempre es un fallo: una cuenta que se
            // conectó y todavía no se dio de alta, o una que se dio de
            // baja y sigue mandando un rato. Se registra con el id para
            // poder identificarla, y se sigue.
            console.warn(`[control] llego un evento de la cuenta ${cuentaIg}, que no es de ningun cliente de alta`)
            continue
        }

        // Con qué se le habla. Se resuelve aquí, antes de despertar su
        // objeto, porque un cliente a medio conectar no tiene con qué
        // contestar y despertarlo sólo para descubrirlo dentro sería
        // esconder el motivo detrás de una llamada más.
        const cred = credencialDe(cliente)
        if (!cred) {
            console.error(
                `[${cliente.clave}] esta de alta pero no tiene con que contestar ` +
                    `(flujo ${cliente.flujo ?? 'instagram'}). Se ignora su evento.`,
            )
            continue
        }

        // El objeto de este cliente. No hay nada que comprobar: se
        // alcanza por nombre y existe desde el momento en que se le
        // nombra. Aqui antes habia que mirar si su enlace estaba
        // declarado en `wrangler.jsonc`, y si no, avisar de que alguien
        // se habia dado de alta sin redesplegar. Ese fallo ya no existe.
        const objeto = env.CLIENTES.get(env.CLIENTES.idFromName(cliente.clave))

        try {
            await objeto.recibir(entrada as Entrada, {
                clave: cliente.clave,
                cred,
                cuenta: cliente.cuenta_ig ?? undefined,
            })
        } catch (err) {
            // Un cliente que revienta no puede llevarse por delante a los
            // demás que vienen en el mismo lote.
            console.error(`[${cliente.clave}] fallo atendiendo su entrada: ${err}`)
        }
    }
}




/**
 * HMAC-SHA256 del cuerpo con el secreto de la app, comparado con la
 * cabecera `x-hub-signature-256`, que llega como `sha256=<hex>`.
 *
 * La comparación va con `timingSafeEqual` y no con `===` porque un `===`
 * sobre cadenas corta en el primer byte distinto, y ese tiempo distinto
 * se mide desde fuera.
 */
/**
 * Cuál de nuestras apps firmó esto, o `null` si ninguna.
 *
 * Devuelve el nombre y no un booleano a propósito: saber **por cuál**
 * entró un evento es lo que permite descubrir que una de las dos dejó de
 * funcionar. Con un sí o no, una app caída se ve igual que un domingo
 * tranquilo.
 */
async function quienFirmo(
    crudo: string,
    cabecera: string | null,
    env: Env,
): Promise<string | null> {
    const secretos: [string, string | undefined][] = [
        ['meta', env.META_APP_SECRET],
        ['instagram', env.META_APP_SECRET_INSTAGRAM],
        ['facebook', env.META_APP_SECRET_FACEBOOK],
    ]
    for (const [quien, secreto] of secretos) {
        if (secreto && (await firmaValida(crudo, cabecera, secreto))) return quien
    }
    return null
}

async function firmaValida(
    crudo: string,
    cabecera: string | null,
    secreto: string,
): Promise<boolean> {
    if (!cabecera?.startsWith('sha256=') || !secreto) return false

    const esperada = hexABytes(cabecera.slice('sha256='.length))
    if (!esperada) return false

    const clave = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secreto),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    )
    const calculada = new Uint8Array(
        await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(crudo)),
    )
    if (calculada.length !== esperada.length) return false
    return crypto.subtle.timingSafeEqual(calculada, esperada)
}

function hexABytes(hex: string): Uint8Array | null {
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    return bytes
}





