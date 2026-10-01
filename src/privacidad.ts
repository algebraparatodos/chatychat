/**
 * Lo que pasa cuando alguien se va o pide que le borren sus datos.
 *
 * ── Por qué existe, y por qué no es papeleo ────────────────────────
 *
 * Meta pide dos direcciones antes de revisar la app: una a la que avisar
 * cuando un negocio nos desconecta, y otra a la que avisar cuando
 * alguien pide que se borren sus datos. Sin las dos no hay revisión.
 *
 * Pero la primera además **arregla un problema real que teníamos**. Hasta
 * ahora, que un cliente nos desconectara se descubría en la pasada diaria
 * de `salud.ts`, o sea hasta veinte horas después, y mientras tanto el
 * bot seguía intentando contestar por él y fallando uno por uno. Con
 * esto nos enteramos en el momento.
 *
 * ── El `signed_request`, que no es un JSON normal ──────────────────
 *
 * Meta manda estas dos llamadas con un formato propio: dos trozos
 * separados por un punto, la firma y el contenido, los dos en base64 de
 * URL. Hay que **comprobar la firma antes de creerse nada**, porque
 * estas direcciones son públicas: sin comprobarla, cualquiera que supiera
 * la URL podría desconectarnos a un cliente o pedir un borrado en su
 * nombre.
 */

import {
    anotarMovimiento,
    apuntarBorrado,
    clienteDeLaCuenta,
    estadoDelBorrado,
    guardarSalud,
    type Env,
} from './base'

const textoPlano = { 'content-type': 'text/plain; charset=utf-8' }
const json = { 'content-type': 'application/json' }

/** Donde la persona puede seguir su solicitud. */
const SEGUIMIENTO = 'https://webhook.example.com/datos/estado'

// ── Cuando un negocio nos desconecta ──────────────────────────────

export async function avisoDeDesconexion(peticion: Request, env: Env): Promise<Response> {
    const datos = await abrirSobre(peticion, env)
    if (!datos) {
        console.warn('[privacidad] llego un aviso de desconexion que no valida')
        return new Response('no\n', { status: 403, headers: textoPlano })
    }

    const cuenta = String(datos.user_id ?? '')
    const cliente = cuenta ? await clienteDeLaCuenta(cuenta, env) : null

    if (!cliente) {
        // Puede pasar y no es un error: si la cuenta ya estaba de baja,
        // o si nunca llegó a completar la conexión. Se registra porque un
        // aviso que no se entiende también dice algo.
        console.warn(`[privacidad] desconexion de la cuenta ${cuenta}, que no es de ningun cliente de alta`)
        return new Response('ok\n', { headers: textoPlano })
    }

    // Se le marca como sin token, que es exactamente lo que pasó: el
    // token que teníamos ya no vale. No se le da de baja, porque irse de
    // verdad es otra cosa y la decide una persona.
    await guardarSalud(cliente.clave, 'token', env)
    await anotarMovimiento(
        cliente.clave,
        'error',
        'desconecto la app desde Instagram: hay que pedirle que vuelva a conectar',
        env,
    )
    console.error(`[privacidad] «${cliente.clave}» nos desconecto`)

    await avisar(
        env,
        `ChatyChat: ${cliente.nombre} desconecto la app`,
        `${cliente.nombre} (${cliente.clave}) acaba de desconectar ChatyChat desde\n` +
            'Instagram, asi que ya no podemos contestar por el.\n\n' +
            'No se arregla solo: hay que hablar con el y, si vuelve, pasarle otra\n' +
            'vez su enlace de conexion.\n',
    )

    return new Response('ok\n', { headers: textoPlano })
}

// ── Cuando alguien pide que le borren sus datos ───────────────────

export async function solicitudDeBorrado(peticion: Request, env: Env): Promise<Response> {
    const datos = await abrirSobre(peticion, env)
    if (!datos) {
        console.warn('[privacidad] llego una solicitud de borrado que no valida')
        return new Response('no\n', { status: 403, headers: textoPlano })
    }

    const quien = String(datos.user_id ?? 'desconocido')
    // Un código que no dice nada de nadie: va en una URL pública y no
    // tiene por qué llevar el identificador de la persona.
    const codigo = crypto.randomUUID().replace(/-/g, '').slice(0, 16)

    const cliente = await clienteDeLaCuenta(quien, env)
    await apuntarBorrado(codigo, quien, cliente?.clave ?? null, env)

    console.log(`[privacidad] solicitud de borrado ${codigo}`)

    // Se avisa al responsable porque **esto lo atiende una persona**. Prometerle
    // a alguien que sus datos se borraron y que no se borren es mucho
    // peor que tardar un día en hacerlo.
    await avisar(
        env,
        'ChatyChat: alguien pidio que le borren sus datos',
        // ⚠️ Aqui NO va el identificador de la persona, y es a proposito.
        //
        // El correo sale por un proveedor de terceros, y mandarle el
        // identificador de un usuario de Meta lo convertiria en
        // **encargado del tratamiento** de datos de la plataforma, con
        // todo lo que eso obliga a declarar y a responder. Con el codigo
        // alcanza: quien atienda esto mira la base, que es donde ese dato
        // ya vive y donde tiene que seguir viviendo.
        //
        // Es ademas lo que pide el reglamento: no sacar un dato personal
        // de donde esta si no hace falta para la tarea.
        `Codigo de la solicitud: ${codigo}\n` +
            `Cliente: ${cliente ? cliente.clave : 'no se pudo identificar'}\n\n` +
            'Quien la pidio esta en la base de control, en la tabla\n' +
            '`borrados`, buscando por ese codigo.\n\n' +
            'Meta ya le dijo a esa persona que la solicitud esta en curso,' +
            ' asi\n' +
            'que hay que atenderla. Cuando este hecha, marcala como hecha\n' +
            'para que la pagina de seguimiento lo diga.\n',
    )

    // Esto es lo que Meta espera, con estos dos nombres exactos.
    return new Response(
        JSON.stringify({ url: `${SEGUIMIENTO}?c=${codigo}`, confirmation_code: codigo }),
        { headers: json },
    )
}

/** La página que ve la persona con su código. */
export async function estadoDeBorrado(url: URL, env: Env): Promise<Response> {
    const codigo = url.searchParams.get('c')
    if (!codigo) {
        return new Response(
            'Falta el codigo de la solicitud.\n\n' +
                'Tiene que ser el enlace entero que te dieron al pedirlo.\n',
            { status: 400, headers: textoPlano },
        )
    }

    const estado = await estadoDelBorrado(codigo, env)
    if (!estado) {
        return new Response(
            'No encontramos ninguna solicitud con ese codigo.\n\n' +
                'Comproba que el enlace este entero. Si sigue sin aparecer,\n' +
                'escribinos a hello@example.com\n',
            { status: 404, headers: textoPlano },
        )
    }

    return new Response(
        estado.estado === 'hecha'
            ? `Tus datos se borraron el ${estado.terminada ?? ''}.\n\n` +
                  `Codigo de la solicitud: ${codigo}\n`
            : `Tu solicitud esta en curso.\n\n` +
                  `La recibimos el ${estado.recibida}.\n` +
                  `Codigo de la solicitud: ${codigo}\n\n` +
                  'Si pasan mas de treinta dias sin que cambie, escribinos a\n' +
                  'hello@example.com\n',
        { headers: textoPlano },
    )
}

// ── El sobre firmado de Meta ──────────────────────────────────────

type Sobre = { user_id?: string; algorithm?: string }

/**
 * Abre el `signed_request` y devuelve su contenido, o `null`.
 *
 * Se prueban **los tres secretos**, por lo mismo que en el webhook: hay
 * dos apps de Meta —la de Instagram Login y la de Facebook Login— mas la
 * app madre, y no siempre firma la que uno espera.
 */
async function abrirSobre(peticion: Request, env: Env): Promise<Sobre | null> {
    let firmado: string | null = null
    try {
        const cuerpo = await peticion.formData()
        firmado = String(cuerpo.get('signed_request') ?? '')
    } catch {
        return null
    }
    if (!firmado || !firmado.includes('.')) return null

    const [firma, contenido] = firmado.split('.', 2)
    const esperada = deBase64Url(firma)
    if (!esperada) return null

    // Las tres claves, por lo mismo que en el webhook: hay dos apps y no
    // siempre firma la que uno espera. La tercera es la de Facebook
    // Login, y sin ella los avisos de borrado de sus clientes se
    // rechazarian con un 403 que no explica nada.
    for (const secreto of [
        env.META_APP_SECRET,
        env.META_APP_SECRET_INSTAGRAM,
        env.META_APP_SECRET_FACEBOOK,
    ]) {
        if (!secreto) continue
        const llave = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secreto),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
        )
        const calculada = new Uint8Array(
            await crypto.subtle.sign('HMAC', llave, new TextEncoder().encode(contenido)),
        )
        if (calculada.length !== esperada.length) continue
        if (crypto.subtle.timingSafeEqual(calculada, esperada)) {
            try {
                const texto = new TextDecoder().decode(deBase64Url(contenido)!)
                return JSON.parse(texto) as Sobre
            } catch {
                return null
            }
        }
    }
    return null
}

/** Base64 de URL, que cambia dos caracteres y se come el relleno. */
function deBase64Url(texto: string): Uint8Array | null {
    try {
        const normal = texto.replace(/-/g, '+').replace(/_/g, '/')
        const relleno = normal + '='.repeat((4 - (normal.length % 4)) % 4)
        const crudo = atob(relleno)
        const bytes = new Uint8Array(crudo.length)
        for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i)
        return bytes
    } catch {
        return null
    }
}

// ── El aviso ──────────────────────────────────────────────────────

async function avisar(env: Env, asunto: string, texto: string): Promise<void> {
    if (!env.RESEND_API_KEY) {
        console.error(`[privacidad] sin RESEND_API_KEY, no se avisa de: ${asunto}`)
        return
    }
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${env.RESEND_API_KEY}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                from: 'ChatyChat <alerts@example.com>',
                to: ['hello@example.com'],
                subject: asunto,
                text: texto,
            }),
        })
        if (!res.ok) console.error(`[privacidad] no se pudo avisar: ${await res.text()}`)
    } catch (err) {
        console.error(`[privacidad] no se pudo avisar: ${err}`)
    }
}
