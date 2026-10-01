/**
 * Conectar una cuenta por el camino de Facebook, el de los clientes que
 * tienen su Instagram enlazado a una Página.
 *
 * ── Por qué existe este archivo además de `conectar.ts` ────────────
 *
 * Porque Meta tiene **dos configuraciones excluyentes** para lo mismo, y
 * cuál toca **no lo decidimos nosotros, lo decide la cuenta del
 * cliente**:
 *
 *   sólo en Instagram        → Instagram Login  → `conectar.ts`
 *   enlazada a una Página    → Facebook Login   → este archivo
 *
 * Y no caben las dos en la misma app: *«You can only add one setup per
 * app»*. De ahí que haya dos apps de Meta, dos claves secretas y dos
 * rutas de vuelta. Está contado en el README («Two Meta login flows»).
 *
 * Soportar sólo uno de los dos sería rechazar a la mayoría de los
 * clientes: casi cualquier negocio con algo de recorrido tiene su
 * Instagram enlazado a una Página.
 *
 * ── Las tres diferencias que importan ──────────────────────────────
 *
 * 1. **Se habla con `graph.facebook.com`**, no con `graph.instagram.com`.
 * 2. **El token es de la Página**, no de la cuenta. Quien manda mensajes
 *    es la Página.
 * 3. **Pero los webhooks siguen llegando identificados por la cuenta de
 *    Instagram.** Así que hay que guardar las dos cosas y no
 *    confundirlas: con una se manda, con la otra se reconoce.
 */

import {
    anotarMovimiento,
    clienteDeLaCuenta,
    clientePorClave,
    guardarTokenDeFacebook,
    type Env,
} from './base'
import { firmarEstado, leerEstado } from './conectar'

const API = 'v23.0'
const textoPlano = { 'content-type': 'text/plain; charset=utf-8' }

/**
 * Los campos del webhook que se piden para la Página.
 *
 * `messages` y compañía son los del buzón; `feed` trae los comentarios
 * de la Página. Los comentarios de Instagram llegan por el objeto
 * `instagram` de la app, que se configura una vez en el panel y no aquí.
 *
 * Se exporta porque `salud.ts` tiene que volver a suscribir con **esta
 * misma lista** cuando encuentra una Página sin suscribir. Dos copias de
 * la lista serían dos listas que un día dicen cosas distintas, y la
 * diferencia se vería como «a este cliente le dejaron de llegar los
 * comentarios» meses después.
 */
export const CAMPOS_DE_PAGINA = 'messages,messaging_postbacks,messaging_referral,message_reactions,feed'

// ── La ida ───────────────────────────────────────────────────────

/**
 * Manda al cliente a autorizar en Facebook.
 *
 * ── El `config_id`, que es lo que distingue esto de un login normal ─
 *
 * «Facebook Login for Business» no se pide con una lista de permisos en
 * la URL, como el login de toda la vida: se pide con el identificador de
 * una **configuración** creada en el panel, que es la que lleva dentro
 * los permisos y qué activos se piden. Así el cliente ve una pantalla
 * preparada en vez de una lista cruda.
 *
 * ⚠️ Y los permisos **no van en la URL**. Si se mandan, Meta los ignora
 * o se queja; lo que vale es lo que diga la configuración.
 */
export async function empezarConexionFacebook(
    clave: string,
    url: URL,
    env: Env,
): Promise<Response> {
    const cliente = await clientePorClave(clave, env)
    if (!cliente) {
        return new Response('Ese enlace no corresponde a ningun cliente.\n', {
            status: 404,
            headers: textoPlano,
        })
    }
    if (!env.META_FACEBOOK_APP_ID || !env.META_FACEBOOK_CONFIG_ID) {
        console.error('[facebook] falta META_FACEBOOK_APP_ID o META_FACEBOOK_CONFIG_ID')
        return new Response('Todavia no podemos conectar por aqui. Ya estamos avisados.\n', {
            status: 503,
            headers: textoPlano,
        })
    }

    const destino = new URL('https://www.facebook.com/' + API + '/dialog/oauth')
    destino.searchParams.set('client_id', env.META_FACEBOOK_APP_ID)
    destino.searchParams.set('redirect_uri', `${url.origin}/oauth/facebook`)
    destino.searchParams.set('config_id', env.META_FACEBOOK_CONFIG_ID)
    destino.searchParams.set('response_type', 'code')
    // El mismo `state` firmado que el otro flujo. Sin esto, cualquiera
    // que supiera la clave de un cliente podria colgarle su propia
    // cuenta de Instagram.
    destino.searchParams.set('state', await firmarEstado(clave, env))

    console.log(`[facebook] ${clave} va a autorizar`)
    return Response.redirect(destino.toString(), 302)
}

// ── La vuelta ────────────────────────────────────────────────────

/**
 * La vuelta de Facebook.
 *
 * ⚠️ **Todo va dentro de un try.** Una excepcion aqui no la ve un
 * desarrollador: la ve el cliente, en forma de pagina de error de
 * Cloudflare con un numero, justo en el momento en que estaba
 * dandonos acceso a su negocio. No puede pasar.
 *
 * Asi que lo que se escape se registra entero y a la persona se le dice
 * algo que se entienda.
 */
export async function volverDeFacebook(url: URL, env: Env): Promise<Response> {
    try {
        return await laVuelta(url, env)
    } catch (err) {
        console.error(`[facebook] EXCEPCION en la vuelta: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
        return new Response(
            [
                'Algo se nos rompio al terminar de conectar.',
                '',
                'Tu autorizacion en Facebook si quedo hecha; lo que fallo es de',
                'nuestro lado y ya estamos avisados.',
                '',
                'Escribinos a hello@example.com y lo dejamos listo.',
                '',
            ].join(String.fromCharCode(10)),
            { status: 500, headers: textoPlano },
        )
    }
}

async function laVuelta(url: URL, env: Env): Promise<Response> {
    const codigo = url.searchParams.get('code')
    const estado = url.searchParams.get('state')
    const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')

    if (error) {
        // Lo mas normal aqui es que la persona le diera a «Cancelar».
        // No es un fallo y no se registra como tal.
        console.log(`[facebook] vuelta con error: ${error}`)
        return new Response(
            `No se completo la conexion: ${error}\n\nPodes volver a intentarlo cuando quieras.\n`,
            { headers: textoPlano },
        )
    }
    if (!codigo || !estado) {
        return new Response(
            'Esta pagina es la vuelta de Facebook y no se abre a mano.\n',
            { status: 400, headers: textoPlano },
        )
    }

    const clave = await leerEstado(estado, env)
    if (!clave) {
        console.warn('[facebook] llego una vuelta con un state que no firmamos')
        return new Response('No pudimos verificar de donde viene esto.\n', {
            status: 403,
            headers: textoPlano,
        })
    }

    // 1. El codigo por un token de usuario.
    const corto = await canjearCodigo(codigo, url, env)
    if ('fallo' in corto) {
        await anotarMovimiento(clave, 'error', `no se pudo canjear el codigo: ${corto.fallo}`, env)
        return falloNuestro()
    }

    // 2. Alargarlo. Aqui **si** se aborta si falla, al reves que en el
    //    otro flujo, y el motivo es concreto: el token de usuario corto
    //    de Facebook dura una hora, y de el se deriva el token de la
    //    Pagina. Un token de Pagina derivado de uno corto hereda esa
    //    hora, asi que seguir con el seria dejar al cliente conectado
    //    hasta la hora de comer.
    const largo = await alargarUsuario(corto.token, env)
    if ('fallo' in largo) {
        await anotarMovimiento(clave, 'error', `no se pudo alargar el token: ${largo.fallo}`, env)
        return falloNuestro()
    }

    // 3. Sus Paginas, y cual de ellas tiene Instagram.
    const paginas = await paginasDe(largo.token)
    if ('fallo' in paginas) {
        await anotarMovimiento(clave, 'error', `no se pudieron leer sus Paginas: ${paginas.fallo}`, env)
        return falloNuestro()
    }

    const conInstagram = paginas.lista.filter((p) => p.instagram_business_account?.id)
    if (conInstagram.length === 0) {
        // Esto NO es un fallo nuestro y hay que decirlo como lo que es.
        console.log(`[facebook] ${clave}: ninguna de sus ${paginas.lista.length} Paginas tiene Instagram`)
        await anotarMovimiento(
            clave,
            'error',
            `autorizo, pero ninguna de sus ${paginas.lista.length} Paginas tiene una cuenta de Instagram enlazada`,
            env,
        )
        return new Response(
            [
                'Falta un paso, y es en Instagram.',
                '',
                'Ninguna de tus paginas de Facebook tiene una cuenta de Instagram',
                'enlazada, y sin eso no podemos contestar por vos.',
                '',
                'Se arregla desde Instagram: Configuracion → Cuenta → Compartir en',
                'otras aplicaciones, o desde la configuracion de tu pagina de',
                'Facebook.',
                '',
                'Si te lias, escribinos a hello@example.com y lo vemos juntos.',
                '',
            ].join(String.fromCharCode(10)),
            { headers: textoPlano },
        )
    }

    // ── Cuales de esas cuentas estan libres ───────────────────────
    //
    // Una persona puede administrar varias Paginas, y algunas de sus
    // cuentas de Instagram pueden estar ya conectadas a OTRO cliente
    // nuestro. Coger la primera a ciegas es lo que rompio el 24/09: se
    // cogio la Pagina enlazada a la cuenta de la propia empresa, que ya
    // era otro cliente, y la base lo rechazo con un choque de clave unica que
    // reventaba hacia fuera.
    //
    // Que `cuenta_ig` sea unica es a proposito y hay que conservarlo: si
    // dos clientes compartieran cuenta, un comentario no sabria de quien
    // es y se le contestaria en nombre del negocio equivocado. Lo que
    // estaba mal era chocar contra esa regla en vez de respetarla al
    // elegir.
    const libres: Pagina[] = []
    const ocupadas: { pagina: string; por: string }[] = []
    for (const p of conInstagram) {
        const ig = p.instagram_business_account!.id
        const duena = await clienteDeLaCuenta(ig, env)
        if (!duena || duena.clave === clave) libres.push(p)
        else ocupadas.push({ pagina: p.name, por: duena.nombre })
    }

    if (libres.length === 0) {
        console.warn(`[facebook] ${clave}: todas sus cuentas ya estan conectadas a otros clientes`)
        await anotarMovimiento(
            clave,
            'error',
            'autorizo, pero todas sus cuentas de Instagram ya estan conectadas a otro cliente: ' +
                ocupadas.map((o) => `${o.pagina} → ${o.por}`).join(', '),
            env,
        )
        return new Response(
            [
                'Esas cuentas ya estan conectadas.',
                '',
                ...ocupadas.map((o) => `  · ${o.pagina} ya la atiende «${o.por}»`),
                '',
                'Una cuenta de Instagram solo puede estar en un sitio: si estuviera',
                'en dos, un comentario no sabria de parte de quien contestar.',
                '',
                'Si querias mover esa cuenta aqui, escribinos a hello@example.com.',
                '',
            ].join(String.fromCharCode(10)),
            { headers: textoPlano },
        )
    }

    // ⚠️ Si quedan varias libres se coge la primera y **se deja dicho**.
    //
    // Elegir en silencio es lo que hace que alguien descubra dentro de un
    // mes que el bot contesta en la cuenta equivocada. Lo que falta aqui
    // es una pantalla para que elija; mientras no este, al menos queda
    // escrito en sus movimientos cual se cogio y cuales habia.
    const elegida = libres[0]
    if (libres.length > 1) {
        console.warn(
            `[facebook] ${clave} tiene ${libres.length} Paginas libres con Instagram; ` +
                `se coge «${elegida.name}». Las otras: ${libres.slice(1).map((p) => p.name).join(', ')}`,
        )
        await anotarMovimiento(
            clave,
            'token',
            `tenia ${libres.length} paginas libres y se cogio «${elegida.name}». ` +
                `Las otras: ${libres.slice(1).map((p) => p.name).join(', ')}. Comprobar que es la que queria.`,
            env,
        )
    }
    if (ocupadas.length) {
        console.log(
            `[facebook] ${clave}: se saltan ${ocupadas.length} paginas ya conectadas a otros: ` +
                ocupadas.map((o) => `${o.pagina} → ${o.por}`).join(', '),
        )
    }

    const cuentaIg = elegida.instagram_business_account!.id

    await guardarTokenDeFacebook(
        clave,
        { tokenPagina: elegida.access_token, paginaId: elegida.id, cuentaIg },
        env,
    )

    // 4. Suscribir la Pagina. Que la app tenga el webhook puesto no
    //    basta: hace falta una llamada por cada Pagina conectada, igual
    //    que en el otro flujo hacia falta una por cuenta. Sin esto la
    //    conexion parece correcta y no llega ni un evento.
    const suscrita = await suscribirPagina(elegida.id, elegida.access_token)
    if ('fallo' in suscrita) {
        await anotarMovimiento(
            clave,
            'error',
            `conectada pero NO suscrita al webhook: ${suscrita.fallo}`,
            env,
        )
        console.error(`[facebook] ${clave} quedo sin suscribir: ${suscrita.fallo}`)
    }

    await anotarMovimiento(
        clave,
        'token',
        `conectada por Facebook: pagina «${elegida.name}» (${elegida.id}), cuenta ${cuentaIg}`,
        env,
    )
    console.log(`[facebook] ${clave} conectado: pagina ${elegida.id}, instagram ${cuentaIg}`)

    return new Response(
        [
            `Listo. «${elegida.name}» esta conectada.`,
            '',
            'Ya podes cerrar esta pestana y volver al panel.',
            '',
        ].join(String.fromCharCode(10)),
        { headers: textoPlano },
    )
}

function falloNuestro(): Response {
    return new Response(
        'No pudimos completar la conexion. Ya estamos avisados y lo miramos.\n',
        { status: 502, headers: textoPlano },
    )
}

// ── Las llamadas a Facebook ──────────────────────────────────────

type Fallo = { fallo: string }

/**
 * Una llamada a la API, con el fallo como valor y no como excepcion.
 *
 * Devuelve `{ datos }` o `{ fallo }` y nunca las dos cosas. Es una
 * union de verdad y no un objeto con campos opcionales, para que
 * TypeScript obligue a mirar cual de las dos vino antes de usarla: un
 * `datos` que podria no estar es justo lo que se acaba leyendo sin
 * comprobar.
 */
async function pedir(destino: URL): Promise<{ datos: Record<string, unknown> } | Fallo> {
    try {
        const res = await fetch(destino.toString())
        const crudo = await res.text()
        let datos: Record<string, unknown>
        try {
            datos = JSON.parse(crudo)
        } catch {
            return { fallo: `HTTP ${res.status} respuesta que no es json: ${crudo.slice(0, 160)}` }
        }
        if (!res.ok) {
            const e = datos.error as { message?: string } | undefined
            return { fallo: `HTTP ${res.status} ${e?.message ?? crudo.slice(0, 160)}` }
        }
        return { datos }
    } catch (err) {
        return { fallo: String(err) }
    }
}

async function canjearCodigo(
    codigo: string,
    url: URL,
    env: Env,
): Promise<{ token: string } | Fallo> {
    const destino = new URL(`https://graph.facebook.com/${API}/oauth/access_token`)
    destino.searchParams.set('client_id', env.META_FACEBOOK_APP_ID!)
    destino.searchParams.set('client_secret', env.META_APP_SECRET_FACEBOOK!)
    // Tiene que ser **exactamente** el mismo que se mando en la ida,
    // hasta la barra final. Meta lo compara caracter a caracter.
    destino.searchParams.set('redirect_uri', `${url.origin}/oauth/facebook`)
    destino.searchParams.set('code', codigo)

    const r = await pedir(destino)
    if ('fallo' in r) return r
    const token = r.datos.access_token as string | undefined
    return token ? { token } : { fallo: `sin access_token: ${JSON.stringify(r.datos).slice(0, 160)}` }
}

/** El de una hora por uno de sesenta días. */
async function alargarUsuario(corto: string, env: Env): Promise<{ token: string } | Fallo> {
    const destino = new URL(`https://graph.facebook.com/${API}/oauth/access_token`)
    destino.searchParams.set('grant_type', 'fb_exchange_token')
    destino.searchParams.set('client_id', env.META_FACEBOOK_APP_ID!)
    destino.searchParams.set('client_secret', env.META_APP_SECRET_FACEBOOK!)
    destino.searchParams.set('fb_exchange_token', corto)

    const r = await pedir(destino)
    if ('fallo' in r) return r
    const token = r.datos.access_token as string | undefined
    return token ? { token } : { fallo: `sin access_token: ${JSON.stringify(r.datos).slice(0, 160)}` }
}

type Pagina = {
    id: string
    name: string
    access_token: string
    instagram_business_account?: { id: string; username?: string }
}

/**
 * Las Páginas de esa persona, con su token y su Instagram.
 *
 * Los activos **no los fija la configuración**: con un token de usuario,
 * Meta deja que el cliente elija sus Páginas en el diálogo de login. Así
 * que aquí se pregunta qué acabó dando, en vez de darlo por sabido.
 */
async function paginasDe(tokenUsuario: string): Promise<{ lista: Pagina[] } | Fallo> {
    const destino = new URL(`https://graph.facebook.com/${API}/me/accounts`)
    destino.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username}')
    destino.searchParams.set('limit', '100')
    destino.searchParams.set('access_token', tokenUsuario)

    const r = await pedir(destino)
    if ('fallo' in r) return r
    return { lista: (r.datos.data as Pagina[] | undefined) ?? [] }
}

/**
 * Deja la Página suscrita al webhook de la app.
 *
 * Se exporta porque hacen falta dos: aquí al conectar, y en `salud.ts`
 * cuando la pasada diaria encuentra una Página que se quedó sin
 * suscribir. Es la misma llamada con los mismos campos, y tenerla dos
 * veces sería tenerla dos veces mal.
 */
export async function suscribirPagina(paginaId: string, tokenPagina: string): Promise<{ ok: true } | Fallo> {
    try {
        const destino = new URL(`https://graph.facebook.com/${API}/${paginaId}/subscribed_apps`)
        destino.searchParams.set('subscribed_fields', CAMPOS_DE_PAGINA)
        destino.searchParams.set('access_token', tokenPagina)

        const res = await fetch(destino.toString(), { method: 'POST' })
        const crudo = await res.text()
        if (!res.ok) return { fallo: `HTTP ${res.status} ${crudo.slice(0, 160)}` }
        return { ok: true }
    } catch (err) {
        return { fallo: String(err) }
    }
}
