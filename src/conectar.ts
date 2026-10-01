/**
 * Cómo un cliente conecta su cuenta de Instagram.
 *
 * ── Por qué esto es el producto ────────────────────────────────────
 *
 * Todo lo demás de este repositorio da igual si un negocio no puede
 * autorizarnos a contestar por él. Hasta aquí, el token de un cliente se
 * ponía a mano: eso sirve para uno y no para veinte.
 *
 * Son dos pantallas y un canje:
 *
 *   1. `/conectar/<clave>` manda al cliente a Instagram.
 *   2. Instagram le pregunta si nos autoriza.
 *   3. Vuelve a `/oauth/instagram` con un código de un solo uso.
 *   4. Ese código se cambia por un token, se alarga a 60 días, se
 *      suscribe su cuenta al webhook y se guarda.
 *
 * ── Las dos credenciales, otra vez ─────────────────────────────────
 *
 * El canje **no usa la clave de la app de Meta**: usa la de la app de
 * Instagram, que es otra y vive en otra pantalla del panel. Ya nos costó
 * horas en el bot que dio origen a esto. Si se confunden, el síntoma es
 * que no llega ningún mensaje, que es exactamente lo que uno espera ver
 * mientras la cuenta todavía no está conectada.
 *
 * ── Y por qué el `state` va firmado ────────────────────────────────
 *
 * Instagram devuelve el `state` tal cual se lo dimos, así que es donde
 * viaja de qué cliente estamos hablando. Si fuera la clave a secas,
 * cualquiera podría abrir el callback con el `state` de otro cliente y
 * **colgarle su propia cuenta de Instagram**, o pisarle el token. Va
 * firmado con HMAC para que sólo valga el que salió de aquí.
 */

import {
    anotarMovimiento,
    clientePorClave,
    guardarTokenDelCliente,
    type Env,
    marcarFlujo,
} from './base'

const textoPlano = { 'content-type': 'text/plain; charset=utf-8' }

/**
 * Los permisos que se le piden al cliente.
 *
 * Con Instagram Login, **estos tres cubren todo lo que hace el bot**:
 *
 * - `instagram_business_basic` es la base y sin ella no hay nada. Es
 *   además la que exige la renovación del token.
 * - `instagram_business_manage_messages` abre los mensajes directos, las
 *   respuestas a historias (que llegan como mensajes con `reply_to`), los
 *   clics en botones y el canal `standby`.
 * - `instagram_business_manage_comments` abre los comentarios, los
 *   comentarios en directo y las menciones en historias.
 *
 * No hace falta ninguno más. En concreto, la respuesta privada a un
 * comentario no tiene permiso propio: sale de tener esos dos últimos.
 *
 * Se piden los tres juntos y no de a poco: cada vez que se añade uno hay
 * que hacer pasar otra vez por la autorización a todos los que ya
 * conectaron, y eso es una tarea manual multiplicada por la cartera.
 */
const PERMISOS = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
].join(',')

/**
 * Los campos del webhook a los que se suscribe cada cuenta.
 *
 * Tienen que estar también marcados en el panel de la app: el panel dice
 * qué puede mandar Meta, y esto dice qué quiere recibir esta cuenta en
 * concreto. Si aquí falta uno que allí está, no llega.
 *
 * -- Se piden de más, a propósito ----------------------------------
 *
 * Hay campos aquí que hoy no se usan, como las reacciones. Están porque
 * cambiar esta lista obliga a **una llamada por cada cliente ya
 * conectado**, o sea una tarea manual multiplicada por la cartera que
 * además nadie recuerda hacer. Lo que llega y no se reconoce se ignora,
 * así que sobrar no cuesta nada y faltar cuesta una migración.
 *
 * **`mentions` no está en esta lista y no es un olvido.** En este flujo
 * las menciones en historias **llegan dentro de `comments`**, y a nivel
 * de app el campo ni siquiera existe: la tabla del panel tiene once
 * campos y `mentions` no es uno de ellos. Pedirlo aquí funcionaba, pero
 * era ruido que hacía pensar que se recibía por un canal propio.
 *
 * `standby` merece una mención: es por donde llegan los mensajes cuando
 * **otra app también está conectada** a la misma cuenta, que es
 * exactamente el caso de un cliente que viene de ManyChat y todavía no
 * lo ha desconectado. Sin este campo, ese cliente parecería roto.
 */
const CAMPOS =
    'comments,live_comments,messages,messaging_postbacks,messaging_referral,message_reactions,standby'

/** La versión de la API, en un solo sitio para no tener dos a la vez. */
const API = 'v23.0'

// ── La ida ────────────────────────────────────────────────────────

/**
 * Manda al cliente a autorizar, o le dice por qué no puede.
 *
 * Los errores se cuentan en castellano y sin tecnicismos porque **esta
 * pantalla la ve el cliente**, no nosotros. Un «500» aquí es un negocio
 * que se queda mirando una página en blanco y que va a escribir para
 * preguntar qué pasó.
 */
export async function empezarConexion(
    clave: string,
    url: URL,
    env: Env,
): Promise<Response> {
    if (!env.META_INSTAGRAM_APP_ID || !env.META_APP_SECRET_INSTAGRAM) {
        console.error('[conectar] faltan META_INSTAGRAM_APP_ID o META_APP_SECRET_INSTAGRAM')
        return new Response(
            'Todavia no podemos conectar cuentas. Avisanos y lo resolvemos.\n',
            { status: 503, headers: textoPlano },
        )
    }

    const cliente = await clientePorClave(clave, env)
    if (!cliente) {
        // Sin decir si la clave existe o no: esta URL es publica.
        console.warn(`[conectar] alguien intento conectar con la clave ${clave}, que no existe`)
        return new Response(
            'Este enlace no es valido. Pedinos uno nuevo.\n',
            { status: 404, headers: textoPlano },
        )
    }
    if (cliente.estado === 'baja') {
        return new Response(
            'Esta cuenta esta dada de baja. Escribinos si queres volver.\n',
            { status: 403, headers: textoPlano },
        )
    }

    // ── Si ya sabemos que le toca el otro camino, no se le hace pasar
    //    por éste ────────────────────────────────────────────────────
    //
    // El flujo de un cliente se descubre la primera vez que intenta
    // conectar: si su cuenta está enlazada a una Página, el token de
    // Instagram Login no la resuelve y queda anotado (más abajo, en la
    // vuelta). A partir de ahí, mandarle otra vez por aquí sería
    // hacerle repetir un fallo que ya conocemos.
    //
    // Hay **dos apps de Meta** y el cliente no tiene por qué saberlo:
    // pincha un único enlace y el que decide por cuál va es esto.
    if (cliente.flujo === 'facebook') {
        console.log(`[conectar] ${clave} va por Facebook, se le manda al otro camino`)
        return Response.redirect(`${url.origin}/conectar-facebook/${clave}`, 302)
    }

    const estado = await firmarEstado(clave, env)
    const destino = new URL('https://www.instagram.com/oauth/authorize')
    destino.searchParams.set('client_id', env.META_INSTAGRAM_APP_ID)
    destino.searchParams.set('redirect_uri', `${url.origin}/oauth/instagram`)
    destino.searchParams.set('response_type', 'code')
    destino.searchParams.set('scope', PERMISOS)
    destino.searchParams.set('state', estado)

    console.log(`[conectar] ${clave} va a autorizar`)
    return Response.redirect(destino.toString(), 302)
}

// ── La vuelta ─────────────────────────────────────────────────────

export async function volverDeInstagram(url: URL, env: Env): Promise<Response> {
    const error = url.searchParams.get('error')
    if (error) {
        const detalle = url.searchParams.get('error_description') ?? ''
        console.warn(`[conectar] Instagram devolvio un error: ${error} ${detalle}`)
        return new Response(
            `Instagram no autorizo la conexion.\n\n${detalle}\n\n` +
                'Podes volver a intentarlo desde el enlace que te pasamos.\n',
            { status: 400, headers: textoPlano },
        )
    }

    const codigo = url.searchParams.get('code')
    const estado = url.searchParams.get('state')
    if (!codigo || !estado) {
        // Alguien abrio esta direccion a mano, escribiendola o desde un
        // marcador. No es un error suyo ni nuestro: esta pagina no es
        // para visitar, es a donde Instagram devuelve al cliente. Se le
        // dice eso y donde tiene que empezar, en vez de un «faltan
        // parametros» que no le sirve a nadie.
        return new Response(
            'Esta pagina no se abre a mano.\n\n' +
                'Es a donde Instagram te devuelve despues de que autorices la\n' +
                'conexion, asi que sola no hace nada.\n\n' +
                'Para conectar tu cuenta, abri el enlace que te pasamos: el que\n' +
                'lleva /conectar/ y el nombre de tu negocio.\n',
            { status: 400, headers: textoPlano },
        )
    }

    const clave = await leerEstado(estado, env)
    if (!clave) {
        // El `state` no lo firmamos nosotros. No se sigue ni un paso más.
        console.warn('[conectar] volvio un code con un state que no firmamos nosotros')
        return new Response('Este enlace no es valido.\n', { status: 403, headers: textoPlano })
    }

    const cliente = await clientePorClave(clave, env)
    if (!cliente) {
        console.error(`[conectar] el state era de ${clave}, que ya no existe`)
        return new Response('Este enlace no es valido.\n', { status: 404, headers: textoPlano })
    }

    // 1. El código por un token corto.
    const corto = await canjear(codigo, url, env)
    if ('fallo' in corto) {
        await anotarMovimiento(clave, 'error', `no se pudo canjear el codigo: ${corto.fallo}`, env)
        return new Response(
            'No pudimos completar la conexion. Ya estamos avisados.\n',
            { status: 502, headers: textoPlano },
        )
    }

    // 2. El token corto por uno de 60 días.
    //
    // El corto dura una hora. Guardarlo sin alargarlo dejaría al cliente
    // funcionando esta tarde y mudo mañana, que es la peor forma de
    // fallar: parece que anduvo y nadie sabe qué cambió.
    // ⚠️ **Si alargar falla NO se aborta la conexion.**
    //
    // El token corto ya sirve: con el se puede contestar. Alargarlo es
    // una mejora, no un requisito, y tirar una conexion que funciona
    // porque fallo la mejora es perder a un cliente por nada. Ademas la
    // pasada diaria renueva tokens, asi que lo que no se alargue aqui se
    // alarga solo mas tarde.
    //
    // Y falla de verdad, no en teoria. El 23/09/2026 una cuenta que **ya
    // habia autorizado la app antes** devolvio «Unsupported request -
    // method type: get» al alargar, con el endpoint y el metodo
    // correctos segun la documentacion de Meta. La sospecha es que en
    // una reautorizacion Instagram devuelve ya un token largo, y alargar
    // uno largo es lo que rechaza. Le va a pasar a cualquiera que se
    // reconecte, asi que tiene que estar contemplado.
    // ── Diagnostico de que CLASE de token nos dieron ──────────────
    //
    // Puesto el 23/09/2026 porque una cuenta devolvio un token con los
    // tres permisos correctos contra el que **todas** las llamadas
    // fallaban con «Unsupported request», en GET y en POST. Eso no es un
    // endpoint mal puesto: es un token que la API de Instagram no
    // reconoce como suyo.
    //
    // Se registra el prefijo, que dice de que familia es —`IGAA` es de
    // Instagram Login, `EAA` es de Facebook— y se prueba la misma
    // consulta contra los dos hosts. Si contesta el de Facebook y no el
    // de Instagram, ya sabemos exactamente que paso.
    //
    // El prefijo **no es el token**: son cuatro caracteres que indican
    // el tipo, igual que el «sha256=» de una firma.
    await diagnosticarToken(corto.token, clave)

    const largo = await alargar(corto.token, env)
    const token = 'fallo' in largo ? corto.token : largo.token

    if ('fallo' in largo) {
        console.warn(`[conectar] ${clave}: no se alargo el token, se sigue con el corto: ${largo.fallo}`)
        await anotarMovimiento(
            clave,
            'token',
            `conectado, pero el token no se pudo alargar (${largo.fallo}). ` +
                'Se guarda el corto y la pasada diaria intentara renovarlo.',
            env,
        )
    }

    // 3. Suscribir SU cuenta al webhook.
    //
    // Que la app tenga el webhook configurado no basta: hace falta una
    // llamada por cada cuenta conectada. Sin esto, la conexión parece
    // correcta, el token sirve, y no llega ni un evento. Es el fallo
    // silencioso clásico de este flujo.
    const suscrita = await suscribir(token)
    if ('fallo' in suscrita) {
        // Se guarda igual. El token es bueno y volver a pedirle al
        // cliente que autorice sería tirar lo que sí salió; la
        // suscripción se puede reintentar sin él.
        await anotarMovimiento(
            clave,
            'error',
            `cuenta conectada pero NO suscrita al webhook: ${suscrita.fallo}`,
            env,
        )
        console.error(`[conectar] ${clave} quedo sin suscribir: ${suscrita.fallo}`)
    }

    // ⚠️ El id que hay que guardar NO es el que devuelve el canje.
    //
    // Instagram maneja dos identificadores para la misma cuenta y los
    // nombra de forma que invita a equivocarse:
    //
    //   el canje devuelve      `user_id`  → es el id de la app (38...)
    //   /me?fields=user_id     `user_id`  → es el id de Instagram (17841...)
    //   /me?fields=id          `id`       → vuelve a ser el de la app
    //
    // **Los webhooks traen el de Instagram**, el que empieza por 17841.
    // Guardar el del canje hace que ningun evento encuentre a su cliente,
    // y el fallo es del peor tipo: no da error en ningun sitio, sencilla-
    // mente no llega nada. Se detecto probandolo con la primera cuenta
    // real.
    const suyo = await idDeInstagram(token)
    if (!suyo) {
        // ── Esto casi nunca es un fallo nuestro ───────────────────
        //
        // Si el token no puede resolver la cuenta, lo mas probable es
        // que **esa cuenta este enlazada a una Pagina de Facebook**.
        // Meta tiene dos configuraciones excluyentes y los tokens no son
        // intercambiables: uno de Instagram Login no sirve para una
        // cuenta con Pagina. Esta contado en el README
        // («Two Meta login flows»), con el sintoma, porque engana mucho.
        //
        // Asi que este fallo **no se tira: ensena algo**. Nos acaba de
        // decir de que tipo es la cuenta de este cliente, que es
        // justamente lo que no se puede saber antes de que autorice. Se
        // anota, y cuando vuelva no hara falta que pase otra vez por
        // aqui.
        // ⚠️ **A un cliente que YA funciona no se le cambia el flujo.**
        //
        // Este camino se escribió pensando en un alta: alguien conecta
        // por primera vez, falla, y lo que falla nos enseña que tiene
        // Página. Pero al mismo sitio llega **una reconexión**, y ahí el
        // mismo fallo significa otra cosa completamente.
        //
        // Un cliente que lleva meses contestando por Instagram Login no
        // tiene Página: tiene un token que ya funciona y un canje que se
        // ha torcido por cualquier motivo pasajero. Marcarle el flujo de
        // Facebook por eso le dejaría **mudo en producción**, porque a
        // partir de ese momento todos sus envíos saldrían contra
        // `graph.facebook.com` con un token de Página que no existe. Y no
        // daría ningún error visible: dejaría de contestar y ya.
        //
        // Se descubrió el 24/09/2026 antes de grabar el vídeo del App
        // Review, que pasa por reconectar la cuenta de la propia
        // empresa. Sin esto, grabar la demostración podía tirar la única
        // cuenta viva que tenemos.
        if (cliente.cuenta_ig && cliente.token) {
            console.error(
                `[conectar] ${clave} ya estaba conectado y el canje no resolvio su cuenta. ` +
                    'NO se le toca el flujo: se deja como estaba.',
            )
            await anotarMovimiento(
                clave,
                'error',
                'reconexion fallida: el token nuevo no resolvio su cuenta. Se conserva el anterior.',
                env,
            )
            return new Response(
                'No pudimos rehacer la conexion, pero tu cuenta sigue funcionando\n' +
                    'con la de antes. No hace falta que hagas nada.\n',
                { headers: textoPlano },
            )
        }

        await marcarFlujo(clave, 'facebook', env)
        await anotarMovimiento(
            clave,
            'token',
            'su cuenta esta enlazada a una Pagina de Facebook: le toca el otro flujo. Anotado.',
            env,
        )
        console.log(`[conectar] ${clave}: cuenta con Pagina, se le manda al camino de Facebook`)

        // ── Y se le lleva, no se le explica ───────────────────────
        //
        // Antes esto devolvía un texto que decía «tu cuenta está
        // enlazada a una Página, escribinos a hello@example.com y lo
        // dejamos listo». O sea: un callejón sin salida, y encima uno
        // que **obliga a una persona a estar detrás de cada alta**, que es lo
        // contrario de lo que este producto tiene que ser.
        //
        // Lo que hay que entender, y es el porqué de todo esto: **cuál
        // de los dos caminos le toca a un cliente no se puede saber
        // antes de que autorice**. Ni él lo sabe: nadie tiene presente
        // si su Instagram está enlazado a una Página de Facebook.
        // Preguntárselo en un formulario sería trasladarle un problema
        // nuestro, y la mitad contestaría mal.
        //
        // Así que se averigua intentándolo, y el intento fallido **no
        // se le hace notar**: se le redirige al otro camino y desde su
        // lado esto es una pantalla de autorización más. Dos apps de
        // Meta, un solo enlace.
        return Response.redirect(`${url.origin}/conectar-facebook/${clave}`, 302)
    }

    await guardarTokenDelCliente(clave, token, suyo, env)
    console.log(
        `[conectar] ${clave} conectado: cuenta ${suyo}` +
            `${'fallo' in suscrita ? ' (SIN suscribir al webhook)' : ''}`,
    )

    return new Response(
        `Listo, ${cliente.nombre}.\n\n` +
            'Tu cuenta de Instagram quedo conectada y ya podemos contestar por vos.\n' +
            'Podes cerrar esta pestana.\n',
        { headers: textoPlano },
    )
}

// ── Las tres llamadas a Instagram ─────────────────────────────────

type Fallo = { fallo: string }

async function canjear(
    codigo: string,
    url: URL,
    env: Env,
): Promise<{ token: string; cuentaIg: string } | Fallo> {
    try {
        const res = await fetch('https://api.instagram.com/oauth/access_token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: env.META_INSTAGRAM_APP_ID!,
                client_secret: env.META_APP_SECRET_INSTAGRAM!,
                grant_type: 'authorization_code',
                redirect_uri: `${url.origin}/oauth/instagram`,
                code: codigo,
            }),
        })
        const crudo = await res.text()
        let datos: { access_token?: string; user_id?: string | number; error_message?: string; permissions?: unknown } = {}
        try {
            datos = JSON.parse(crudo)
        } catch {
            return { fallo: `HTTP ${res.status} respuesta que no es json: ${crudo.slice(0, 200)}` }
        }

        // Se deja constancia de la FORMA de lo que contesto Meta, nunca
        // del token. Cuando esto falla, lo unico que se tiene es el
        // registro, y saber que campos vinieron es la mitad del
        // diagnostico.
        console.log(
            `[conectar] canje: HTTP ${res.status}, campos: ${Object.keys(datos).join(',')}` +
                `, largo del token: ${String(datos.access_token ?? '').length}` +
                `, permisos: ${JSON.stringify(datos.permissions ?? null)}`,
        )

        if (!res.ok || !datos.access_token || !datos.user_id) {
            return { fallo: `HTTP ${res.status} ${datos.error_message ?? crudo.slice(0, 200)}` }
        }
        return { token: datos.access_token, cuentaIg: String(datos.user_id) }
    } catch (err) {
        return { fallo: String(err) }
    }
}

async function alargar(corto: string, env: Env): Promise<{ token: string } | Fallo> {
    try {
        const destino = new URL('https://graph.instagram.com/access_token')
        destino.searchParams.set('grant_type', 'ig_exchange_token')
        destino.searchParams.set('client_secret', env.META_APP_SECRET_INSTAGRAM!)
        destino.searchParams.set('access_token', corto)

        const res = await fetch(destino.toString())
        const crudo = await res.text()

        // La respuesta entera al registro cuando algo va mal. Sin esto,
        // un «Unsupported request» de Meta no dice nada: no menciona ni
        // el endpoint ni el motivo, y hay que adivinar.
        if (!res.ok) {
            console.error(
                `[conectar] alargar fallo: HTTP ${res.status}` +
                    `, largo del token corto: ${corto.length}` +
                    `, hay secreto: ${Boolean(env.META_APP_SECRET_INSTAGRAM)}` +
                    `, respuesta: ${crudo.slice(0, 300)}`,
            )
        }

        let datos: { access_token?: string; error?: { message?: string } } = {}
        try {
            datos = JSON.parse(crudo)
        } catch {
            return { fallo: `HTTP ${res.status} respuesta que no es json: ${crudo.slice(0, 200)}` }
        }
        if (!res.ok || !datos.access_token) {
            return { fallo: `HTTP ${res.status} ${datos.error?.message ?? crudo.slice(0, 200)}` }
        }
        return { token: datos.access_token }
    } catch (err) {
        return { fallo: String(err) }
    }
}

/**
 * El id de Instagram de la cuenta, que es el que traen los webhooks.
 *
 * Se pregunta en vez de deducirlo del canje porque el canje devuelve
 * otro, con el mismo nombre de campo. Ver el comentario de arriba.
 */
async function idDeInstagram(token: string): Promise<string | null> {
    try {
        const destino = new URL(`https://graph.instagram.com/${API}/me`)
        destino.searchParams.set('fields', 'user_id,username')
        destino.searchParams.set('access_token', token)
        const res = await fetch(destino.toString())
        const datos = (await res.json()) as { user_id?: string | number }
        if (!res.ok || !datos.user_id) return null
        return String(datos.user_id)
    } catch {
        return null
    }
}

async function suscribir(token: string): Promise<{ ok: true } | Fallo> {
    try {
        const res = await fetch(`https://graph.instagram.com/${API}/me/subscribed_apps`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ subscribed_fields: CAMPOS, access_token: token }),
        })
        const datos = (await res.json()) as { success?: boolean; error?: { message?: string } }
        if (!res.ok || datos.success === false) {
            return { fallo: `HTTP ${res.status} ${datos.error?.message ?? JSON.stringify(datos)}` }
        }
        return { ok: true }
    } catch (err) {
        return { fallo: String(err) }
    }
}

// ── El `state` firmado ────────────────────────────────────────────

/**
 * `<clave>.<firma>`, donde la firma es HMAC de la clave.
 *
 * No lleva caducidad, y es una decisión: un cliente puede tardar días en
 * darle al enlace que le mandamos, y un enlace que caduca solo genera
 * una conversación («me dice que no vale») por cada cliente despistado.
 * Lo que protege no es el tiempo sino que **sólo nosotros podemos
 * firmarlo**, que es lo que impide colgarle una cuenta a otro.
 */
export async function firmarEstado(clave: string, env: Env): Promise<string> {
    return `${clave}.${await hmac(clave, env.META_APP_SECRET)}`
}

export async function leerEstado(estado: string, env: Env): Promise<string | null> {
    const corte = estado.lastIndexOf('.')
    if (corte < 1) return null
    const clave = estado.slice(0, corte)
    const firma = estado.slice(corte + 1)
    // Se recalcula y se compara en tiempo constante, igual que la firma
    // del webhook: comparar cadenas con === filtra por dónde falla.
    const esperada = await hmac(clave, env.META_APP_SECRET)
    if (firma.length !== esperada.length) return null
    const a = new TextEncoder().encode(firma)
    const b = new TextEncoder().encode(esperada)
    return crypto.subtle.timingSafeEqual(a, b) ? clave : null
}

async function hmac(texto: string, secreto: string): Promise<string> {
    const llave = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secreto),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    )
    const firma = new Uint8Array(
        await crypto.subtle.sign('HMAC', llave, new TextEncoder().encode(texto)),
    )
    return [...firma].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Dice de que clase es un token, sin imprimirlo.
 *
 * Los cuatro primeros caracteres identifican la familia y no permiten
 * reconstruir nada. Lo que se busca es distinguir un token de Instagram
 * Login de uno de Facebook, que es la diferencia que hace que una
 * llamada funcione o devuelva «Unsupported request».
 */
async function diagnosticarToken(token: string, clave: string): Promise<void> {
    const familia = token.startsWith('IGAA') ? 'Instagram Login' : token.startsWith('EAA') ? 'Facebook' : 'desconocida'

    let porInstagram = 'no se probo'
    let porFacebook = 'no se probo'
    try {
        const a = await fetch(`https://graph.instagram.com/v23.0/me?fields=user_id&access_token=${encodeURIComponent(token)}`)
        porInstagram = `${a.status} ${(await a.text()).slice(0, 140)}`
    } catch (err) {
        porInstagram = String(err)
    }
    try {
        const b = await fetch(`https://graph.facebook.com/v23.0/me?access_token=${encodeURIComponent(token)}`)
        porFacebook = `${b.status} ${(await b.text()).slice(0, 140)}`
    } catch (err) {
        porFacebook = String(err)
    }

    console.log(
        `[conectar] ${clave} DIAGNOSTICO del token: familia ${familia}, prefijo ${token.slice(0, 4)}, largo ${token.length}` +
            ` | graph.instagram.com -> ${porInstagram}` +
            ` | graph.facebook.com -> ${porFacebook}`,
    )
}
