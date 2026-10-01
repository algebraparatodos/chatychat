/**
 * Que a un cliente no se le caduque el token, y enterarnos si aun así
 * deja de recibir.
 *
 * ── Lo primero: un token no tiene por qué caducar nunca ────────────
 *
 * El token largo de Instagram dura 60 días, pero **se puede renovar
 * indefinidamente** mientras se renueve antes de que expire. Así que la
 * pregunta correcta no es «¿cómo me entero de que caducó?» sino «¿por
 * qué iba a caducar?». Si le caduca a un cliente, es que fallamos
 * nosotros.
 *
 * Por eso esto renueva a los 30 días y no a los 55: deja un mes entero
 * de margen. Para que un token se pierda tendrían que fallar treinta
 * pasadas diarias seguidas, y eso ya no es un descuido, es un servicio
 * caído que se nota por otras vías.
 *
 * ── Y aun así hace falta vigilar ───────────────────────────────────
 *
 * Porque hay dos cosas que la renovación no puede evitar:
 *
 * - **Que el cliente nos desconecte.** Si quita la app desde Instagram,
 *   cambia su contraseña o Meta revoca el token, no hay renovación que
 *   valga. Eso no es un fallo nuestro, pero sí tenemos que enterarnos,
 *   porque el cliente va a decir «no contesta» y no «desconecté la app».
 *
 * - **Que su cuenta se quede sin suscribir.** El token sirve, todo
 *   parece bien, y no llega ni un evento. Es el fallo más silencioso de
 *   todos: lo que se ve es silencio, que es exactamente lo que se ve un
 *   domingo tranquilo.
 *
 * ── Por qué sólo se avisa cuando algo cambia ───────────────────────
 *
 * Un correo diario diciendo «todo bien» se deja de leer en una semana, y
 * entonces el día que dice otra cosa tampoco se lee. Se avisa cuando un
 * cliente pasa a estar mal, y cuando vuelve a estar bien. Nada más.
 */

import {
    anotarMovimiento,
    clientesDeAlta,
    leerMarca,
    escribirMarca,
    guardarRenovacion,
    guardarSalud,
    type Ficha,
    type Env,
} from './base'
import { suscribirPagina } from './conectar-facebook'

/** A los cuántos días se renueva un token de 60. */
const RENOVAR_A_LOS_DIAS = 30

/** Cada cuánto se hace la pasada diaria, en horas. */
const CADA_HORAS = 20

const API = 'v23.0'
/** Los mismos campos que en `conectar.ts`, y por el mismo motivo. */
const CAMPOS =
    'comments,live_comments,messages,messaging_postbacks,messaging_referral,message_reactions,standby'

/**
 * La pasada diaria, llamada desde el cron de cada cinco minutos.
 *
 * Devuelve pronto casi siempre: sólo trabaja si han pasado las horas.
 */
export async function pasadaDiaria(env: Env): Promise<void> {
    const ultima = await leerMarca('ultima_revision', env)
    if (ultima) {
        const cuando = Date.parse(`${ultima.replace(' ', 'T')}Z`)
        if (!Number.isNaN(cuando) && Date.now() - cuando < CADA_HORAS * 3_600_000) return
    }

    // Se marca **antes** de empezar. Si dos pasadas se solaparan,
    // renovarían el mismo token dos veces, y la segunda lo haría con un
    // token que la primera acaba de reemplazar.
    await escribirMarca('ultima_revision', env)

    let clientes: Ficha[]
    try {
        clientes = await clientesDeAlta(env)
    } catch (err) {
        console.error(`[salud] no se pudo leer la lista de clientes: ${err}`)
        return
    }

    const novedades: string[] = []

    for (const cliente of clientes) {
        try {
            await revisarUno(cliente, env, novedades)
        } catch (err) {
            // Un cliente que revienta no puede dejar sin revisar a los
            // que vienen detrás.
            console.error(`[salud] fallo revisando «${cliente.clave}»: ${err}`)
        }
    }

    console.log(`[salud] ${clientes.length} clientes revisados, ${novedades.length} novedades`)
    if (novedades.length) await avisar(novedades, env)
}

/**
 * Revisa un cliente por el camino que le toque.
 *
 * ── Por qué son dos revisiones y no una con ramas dentro ───────────
 *
 * Porque **no se revisa lo mismo**. Un cliente de Instagram Login tiene
 * un token que caduca a los 60 días y hay que renovarlo; uno de Facebook
 * Login tiene un token de Página que, según la documentación de Meta,
 * *«no tiene fecha de caducidad y sólo se invalida bajo ciertas
 * condiciones»*. Renovar el segundo no es que falle: es que no existe la
 * llamada.
 *
 * Meterlo todo en una función con `if` por medio haría que la mitad de
 * las comprobaciones no aplicaran nunca a la mitad de los clientes, que
 * es la forma segura de que un día se comprueben al revés.
 */
async function revisarUno(cliente: Ficha, env: Env, novedades: string[]): Promise<void> {
    if (cliente.flujo === 'facebook') {
        return await revisarPorFacebook(cliente, env, novedades)
    }
    return await revisarPorInstagram(cliente, env, novedades)
}

/**
 * Un cliente conectado con su Página de Facebook.
 *
 * Tres cosas, y ninguna es renovar:
 *
 *   1. Que tengamos con qué hablarle, o sea el token y el id de la
 *      Página. Los dos o ninguno: conectar a medias es un estado que
 *      existe, porque el canje puede cortarse entre una llamada y la
 *      siguiente.
 *   2. Que ese token siga sirviendo **y siga resolviendo su Instagram**.
 *      Se piden las dos cosas en la misma llamada a propósito: un token
 *      que vale pero cuya Página ya no tiene Instagram enlazado es un
 *      cliente al que no se le puede contestar, y desde fuera se vería
 *      igual que si todo estuviera bien.
 *   3. Que la Página siga suscrita al webhook, que es lo único de aquí
 *      que se arregla solo.
 */
async function revisarPorFacebook(cliente: Ficha, env: Env, novedades: string[]): Promise<void> {
    if (!cliente.token_pagina || !cliente.pagina_fb) {
        await cambioDeSalud(
            cliente,
            'token',
            'quedo conectado a medias por Facebook: falta el token de la Pagina o su id',
            env,
            novedades,
        )
        return
    }

    const pagina = await comprobarPagina(cliente.pagina_fb, cliente.token_pagina)
    if ('fallo' in pagina) {
        await cambioDeSalud(
            cliente,
            'token',
            `su token de Pagina ya no sirve: ${pagina.fallo}`,
            env,
            novedades,
        )
        return
    }
    if (!pagina.instagram) {
        await cambioDeSalud(
            cliente,
            'token',
            `su Pagina «${pagina.nombre}» ya no tiene ninguna cuenta de Instagram enlazada`,
            env,
            novedades,
        )
        return
    }
    if (pagina.instagram !== cliente.cuenta_ig) {
        // Esto no se arregla solo a propósito. Que la Página apunte ahora
        // a otra cuenta puede ser un cambio legítimo del cliente o puede
        // ser un error suyo, y actualizarlo por nuestra cuenta haría que
        // el bot empezara a contestar en una cuenta que nadie pidió.
        await cambioDeSalud(
            cliente,
            'cuenta',
            `su Pagina apunta ahora a la cuenta ${pagina.instagram} y no a la ${cliente.cuenta_ig} que tenemos apuntada`,
            env,
            novedades,
        )
        return
    }

    const suscrita = await comprobarSuscripcionDePagina(cliente.pagina_fb, cliente.token_pagina)
    if ('fallo' in suscrita) {
        console.warn(
            `[salud] no se pudo comprobar la suscripcion de la pagina de «${cliente.clave}»: ${suscrita.fallo}`,
        )
        return
    }
    if (!suscrita.suscrita) {
        const arreglada = await suscribirPagina(cliente.pagina_fb, cliente.token_pagina)
        if ('fallo' in arreglada) {
            await cambioDeSalud(
                cliente,
                'suscripcion',
                `su Pagina no esta suscrita al webhook y no se pudo arreglar: ${arreglada.fallo}`,
                env,
                novedades,
            )
            return
        }
        console.log(`[salud] la pagina de «${cliente.clave}» estaba sin suscribir, se volvio a suscribir`)
        await anotarMovimiento(
            cliente.clave,
            'error',
            'su Pagina estaba sin suscribir, se arreglo solo',
            env,
        )
    }

    await cambioDeSalud(cliente, 'bien', 'todo en orden', env, novedades)
}

/** Un cliente conectado sólo con su Instagram. El camino de siempre. */
async function revisarPorInstagram(cliente: Ficha, env: Env, novedades: string[]): Promise<void> {
    if (!cliente.token) {
        await cambioDeSalud(cliente, 'token', 'no tiene token: nunca conecto su cuenta', env, novedades)
        return
    }

    // 1. Renovar si toca. Va primero porque si el token está a punto de
    //    caducar, lo urgente es salvarlo, no diagnosticarlo.
    let token = cliente.token
    if (tocaRenovar(cliente)) {
        const nuevo = await renovar(token)
        if ('fallo' in nuevo) {
            // Que la renovación falle es la señal temprana de que el
            // token ya no vale. Se dice aquí y no se espera a que falle
            // un envío delante de un cliente.
            await cambioDeSalud(
                cliente,
                'token',
                `no se pudo renovar su token: ${nuevo.fallo}`,
                env,
                novedades,
            )
            return
        }
        token = nuevo.token
        await guardarRenovacion(cliente.clave, token, env)
        console.log(`[salud] token de «${cliente.clave}» renovado por 60 dias mas`)
    }

    // 2. ¿El token sirve?
    const quien = await comprobarToken(token)
    if ('fallo' in quien) {
        await cambioDeSalud(cliente, 'token', `su token ya no sirve: ${quien.fallo}`, env, novedades)
        return
    }

    // 3. ¿Su cuenta está suscrita al webhook?
    const suscrita = await comprobarSuscripcion(token)
    if ('fallo' in suscrita) {
        // Aquí no se sabe si está suscrita o si la consulta falló, así
        // que no se toca su estado: marcar «roto» por un fallo de red
        // haría saltar un aviso cada vez que Meta tose.
        console.warn(`[salud] no se pudo comprobar la suscripcion de «${cliente.clave}»: ${suscrita.fallo}`)
        return
    }
    if (!suscrita.suscrita) {
        // Esto se arregla solo, sin molestar al cliente: se vuelve a
        // suscribir con su propio token. Es lo que pide la regla de que
        // la causa de fondo va antes que el trámite manual.
        const arreglada = await volverASuscribir(token)
        if ('fallo' in arreglada) {
            await cambioDeSalud(
                cliente,
                'suscripcion',
                `su cuenta no esta suscrita al webhook y no se pudo arreglar: ${arreglada.fallo}`,
                env,
                novedades,
            )
            return
        }
        console.log(`[salud] «${cliente.clave}» estaba sin suscribir, se volvio a suscribir`)
        await anotarMovimiento(cliente.clave, 'error', 'estaba sin suscribir, se arreglo solo', env)
    }

    await cambioDeSalud(cliente, 'bien', 'todo en orden', env, novedades)
}

function tocaRenovar(cliente: Ficha): boolean {
    // Sin fecha, se renueva. Un cliente que viene de antes de que
    // existiera esta columna tiene un token de edad desconocida, y
    // renovar de más no cuesta nada: renovar de menos cuesta el cliente.
    if (!cliente.token_renovado) return true
    const cuando = Date.parse(`${cliente.token_renovado.replace(' ', 'T')}Z`)
    if (Number.isNaN(cuando)) return true
    return Date.now() - cuando > RENOVAR_A_LOS_DIAS * 86_400_000
}

/**
 * Anota el estado y, **sólo si cambió**, lo apunta para el aviso.
 */
async function cambioDeSalud(
    cliente: Ficha,
    salud: string,
    detalle: string,
    env: Env,
    novedades: string[],
): Promise<void> {
    if (cliente.salud === salud) return

    await guardarSalud(cliente.clave, salud, env)
    await anotarMovimiento(cliente.clave, salud === 'bien' ? 'alta' : 'error', detalle, env)

    if (salud === 'bien') {
        novedades.push(`✅ ${cliente.nombre} (${cliente.clave}) vuelve a estar bien.`)
    } else {
        novedades.push(`⚠️ ${cliente.nombre} (${cliente.clave}): ${detalle}`)
        console.error(`[salud] «${cliente.clave}» pasa a «${salud}»: ${detalle}`)
    }
}

// ── Las llamadas a Instagram ──────────────────────────────────────

type Fallo = { fallo: string }

async function renovar(token: string): Promise<{ token: string } | Fallo> {
    try {
        const destino = new URL('https://graph.instagram.com/refresh_access_token')
        destino.searchParams.set('grant_type', 'ig_refresh_token')
        destino.searchParams.set('access_token', token)
        const res = await fetch(destino.toString())
        const datos = (await res.json()) as { access_token?: string; error?: { message?: string } }
        if (!res.ok || !datos.access_token) {
            return { fallo: `HTTP ${res.status} ${datos.error?.message ?? JSON.stringify(datos)}` }
        }
        return { token: datos.access_token }
    } catch (err) {
        return { fallo: String(err) }
    }
}

async function comprobarToken(token: string): Promise<{ usuario: string } | Fallo> {
    try {
        const destino = new URL(`https://graph.instagram.com/${API}/me`)
        destino.searchParams.set('fields', 'id,username')
        destino.searchParams.set('access_token', token)
        const res = await fetch(destino.toString())
        const datos = (await res.json()) as { username?: string; error?: { message?: string } }
        if (!res.ok || !datos.username) {
            return { fallo: `HTTP ${res.status} ${datos.error?.message ?? JSON.stringify(datos)}` }
        }
        return { usuario: datos.username }
    } catch (err) {
        return { fallo: String(err) }
    }
}

async function comprobarSuscripcion(token: string): Promise<{ suscrita: boolean } | Fallo> {
    try {
        const destino = new URL(`https://graph.instagram.com/${API}/me/subscribed_apps`)
        destino.searchParams.set('access_token', token)
        const res = await fetch(destino.toString())
        const datos = (await res.json()) as {
            data?: { subscribed_fields?: string[] }[]
            error?: { message?: string }
        }
        if (!res.ok) {
            return { fallo: `HTTP ${res.status} ${datos.error?.message ?? JSON.stringify(datos)}` }
        }
        // Una lista vacía significa que no hay suscripción. Que haya
        // alguna entrada con campos basta: si faltara alguno, volver a
        // suscribir lo corrige y no hace falta distinguirlo aquí.
        const suscrita = (datos.data ?? []).some((d) => (d.subscribed_fields ?? []).length > 0)
        return { suscrita }
    } catch (err) {
        return { fallo: String(err) }
    }
}

async function volverASuscribir(token: string): Promise<{ ok: true } | Fallo> {
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

// ── Las llamadas a Facebook ───────────────────────────────────────
//
// Otro host y otro token. El porqué está en `enviar.ts` y en el README
// («Two Meta login flows»): cruzarlos da errores que no hablan de lo que pasa.

const GRAFO_FB = `https://graph.facebook.com/${API}`

/**
 * Que el token de la Página siga sirviendo, y a qué Instagram lleva.
 *
 * Las dos cosas en una sola llamada. `instagram_business_account` es el
 * campo que ata la Página con la cuenta, y es exactamente el que se usó
 * al conectar: si aquí viniera otro, el cliente ha movido algo.
 */
async function comprobarPagina(
    paginaId: string,
    tokenPagina: string,
): Promise<{ nombre: string; instagram: string | null } | Fallo> {
    try {
        const destino = new URL(`${GRAFO_FB}/${paginaId}`)
        destino.searchParams.set('fields', 'name,instagram_business_account')
        destino.searchParams.set('access_token', tokenPagina)
        const res = await fetch(destino.toString())
        const datos = (await res.json()) as {
            name?: string
            instagram_business_account?: { id?: string }
            error?: { message?: string }
        }
        if (!res.ok) {
            return { fallo: `HTTP ${res.status} ${datos.error?.message ?? JSON.stringify(datos)}` }
        }
        return {
            nombre: datos.name ?? paginaId,
            instagram: datos.instagram_business_account?.id ?? null,
        }
    } catch (err) {
        return { fallo: String(err) }
    }
}

async function comprobarSuscripcionDePagina(
    paginaId: string,
    tokenPagina: string,
): Promise<{ suscrita: boolean } | Fallo> {
    try {
        const destino = new URL(`${GRAFO_FB}/${paginaId}/subscribed_apps`)
        destino.searchParams.set('access_token', tokenPagina)
        const res = await fetch(destino.toString())
        const datos = (await res.json()) as {
            data?: { subscribed_fields?: string[] }[]
            error?: { message?: string }
        }
        if (!res.ok) {
            return { fallo: `HTTP ${res.status} ${datos.error?.message ?? JSON.stringify(datos)}` }
        }
        const suscrita = (datos.data ?? []).some((d) => (d.subscribed_fields ?? []).length > 0)
        return { suscrita }
    } catch (err) {
        return { fallo: String(err) }
    }
}

// ── El aviso ──────────────────────────────────────────────────────

/**
 * Un correo al responsable, y sólo cuando algo cambió.
 *
 * Si falla el envío se registra y no se reintenta: el estado ya quedó
 * guardado en la base, así que la información no se pierde, sólo el
 * empujón. Reintentar aquí podría mandar el mismo aviso varias veces,
 * que es peor que mandarlo tarde.
 */
async function avisar(novedades: string[], env: Env): Promise<void> {
    if (!env.RESEND_API_KEY) {
        console.error('[salud] hay novedades pero falta RESEND_API_KEY, no se avisa')
        return
    }

    const malas = novedades.filter((n) => n.startsWith('⚠️')).length
    const asunto = malas
        ? `ChatyChat: ${malas} cliente${malas > 1 ? 's' : ''} con problemas`
        : 'ChatyChat: todo vuelve a estar bien'

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
                text:
                    `${novedades.join('\n\n')}\n\n` +
                    '— — —\n\n' +
                    'Qué significa cada cosa:\n\n' +
                    'Su token ya no sirve: el cliente desconecto la app, cambio su\n' +
                    'contrasena o Meta lo revoco. Hay que pedirle que vuelva a\n' +
                    'conectar su cuenta. No se arregla solo.\n\n' +
                    'No esta suscrita al webhook: el token sirve pero no le llega\n' +
                    'nada. Se intenta arreglar solo en cada pasada; si sigue\n' +
                    'saliendo, hay algo mas.\n',
            }),
        })
        if (!res.ok) {
            console.error(`[salud] no se pudo avisar (HTTP ${res.status}): ${await res.text()}`)
            return
        }
        console.log(`[salud] aviso mandado con ${novedades.length} novedades`)
    } catch (err) {
        console.error(`[salud] no se pudo avisar: ${err}`)
    }
}
