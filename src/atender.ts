/**
 * Lo que se hace con un aviso de Meta, una vez se sabe de quién es.
 *
 * ── Dónde corre esto ───────────────────────────────────────────────
 *
 * Dentro del Durable Object del cliente, sobre su propio SQLite. Por eso
 * recibe `sql` y no una base: el objeto ya es su base.
 *
 * Y está aquí, en un módulo suelto, y no dentro de la clase del objeto
 * a propósito. El objeto se ocupa de lo suyo —el almacenamiento, las
 * alarmas, quién puede llamarle— y esto es la lógica del producto, que
 * conviene poder leer y probar sin montar un Durable Object alrededor.
 *
 * ── Casi nada de esto espera ───────────────────────────────────────
 *
 * Las consultas son síncronas. Los únicos `await` que quedan son los
 * envíos a Meta, que son lo único que de verdad sale a la red. Antes
 * había un `await` por consulta y costaba distinguir lo caro de lo
 * barato leyendo el código.
 */

import { buscarDisparador, contarDisparo } from './disparadores'
import {
    avisarEnPublico,
    responder,
    responderComentario,
    responderConBotones,
    type Credencial,
} from './enviar'
import { cerrarReserva, guardarMensaje, reservarComentario, ultimoMensajeDe } from './eventos'
import { cajaDelBoton, cajaPorId, primeraCaja, type Caja } from './flujos'
import { apartarParaLuego } from './pendientes'
import { cabenEstaHora } from './ritmo'
import { sePuedeEscribirAlBuzon } from './ventanas'

// ── La forma de lo que manda Meta ────────────────────────────────

/** Lo que trae un comentario dentro de `changes[].value`. */
export type ValorDeComentario = {
    id?: string
    text?: string
    from?: { id?: string; username?: string }
    media?: { id?: string; media_product_type?: string }
    parent_id?: string
}

export type EventoDeMensaje = {
    sender?: { id?: string }
    recipient?: { id?: string }
    timestamp?: number
    postback?: { mid?: string; title?: string; payload?: string }
    message?: {
        mid?: string
        text?: string
        is_echo?: boolean
        quick_reply?: { payload?: string }
        reply_to?: { story?: { id?: string; url?: string }; mid?: string }
    }
}

export type Entrada = {
    id?: string
    time?: number
    changes?: { field?: string; value?: ValorDeComentario }[]
    messaging?: EventoDeMensaje[]
    /** El mismo formato, para las apps que no son la receptora principal. */
    standby?: EventoDeMensaje[]
}

export type EventoDeMeta = {
    object?: string
    entry?: Entrada[]
}

/**
 * Lo poco que hace falta saber del cliente para atenderle.
 *
 * Lleva la **credencial** entera y no el token suelto porque, desde que
 * hay dos flujos de Meta, el token por sí solo no dice a qué host hay
 * que llamar. El porqué largo está en `enviar.ts`, que es quien define
 * ese tipo; aquí basta con no romperlo por el camino.
 */
export type Quien = { clave: string; cred: Credencial; cuenta: string | undefined }

// ── El reparto ───────────────────────────────────────────────────

export async function atenderEntrada(
    entrada: Entrada,
    quien: Quien,
    sql: SqlStorage,
): Promise<void> {
    // Los comentarios llegan en `changes` y los mensajes en `messaging` o
    // en `standby`. Es el mismo POST y la misma cuenta, pero dos formas
    // distintas dentro, y es de lo que mas cuesta darse cuenta leyendo la
    // documentacion de Meta.
    for (const cambio of entrada.changes ?? []) {
        if (cambio.field !== 'comments') continue
        await atenderComentario(cambio.value, entrada.id, quien, sql)
    }

    const mensajes = [
        ...(entrada.messaging ?? []).map((m) => ({ m, canal: 'principal' as const })),
        ...(entrada.standby ?? []).map((m) => ({ m, canal: 'standby' as const })),
    ]
    for (const { m, canal } of mensajes) {
        await atenderMensaje(m, canal, quien, sql)
    }
}

// ── Comentarios ──────────────────────────────────────────────────

async function atenderComentario(
    v: ValorDeComentario | undefined,
    cuenta: string | undefined,
    quien: Quien,
    sql: SqlStorage,
): Promise<void> {
    const idComentario = v?.id
    const de = v?.from?.id
    if (!idComentario || !de) return

    // Un comentario de la propia cuenta es la respuesta publica que
    // acabamos de poner nosotros. Sin este corte, el bot se contesta a si
    // mismo.
    if (de === cuenta) return

    const media = v?.media?.id
    console.log(
        `[${quien.clave}] comentario de @${v?.from?.username ?? '?'} en ${media ?? '?'}: ` +
            `${JSON.stringify(v?.text ?? null)}`,
    )

    // Se aparta ANTES de contestar. El porque esta en `eventos.ts`: el
    // mismo comentario llega dos veces y un SELECT previo no lo evita.
    const reserva = reservarComentario(sql, {
        de,
        usuario: v?.from?.username,
        texto: v?.text,
        comentarioId: idComentario,
        mediaId: media,
    })
    if (!reserva.nuestro) {
        console.log(`[${quien.clave}] ${idComentario} ya estaba atendido, llego duplicado`)
        return
    }

    const elegida = buscarDisparador(sql, v?.text, 'comentario', media)
    // El evento ya quedo guardado por la reserva, dispare o no. Que se
    // guarde aunque no dispare es a proposito: un comentario que hoy no
    // dispara nada es justo el que manana hay que poder encontrar para
    // contestarlo a mano.
    if (!elegida) return

    contarDisparo(sql, elegida)

    // ¿Cabe esta hora?
    //
    // Contestar son DOS llamadas a Meta: el privado y el aviso publico.
    // El tope es de 750 por hora y por cuenta, y un reel que se vuelve
    // viral lo agota en minutos. Lo que no cabe **no se tira**: una
    // respuesta privada tiene 7 dias de plazo, asi que lo de esta hora
    // cabe en la siguiente.
    const cuantas = elegida.avisoPublico?.trim() ? 2 : 1
    if (!cabenEstaHora(sql, cuantas, quien.clave)) {
        apartarParaLuego(sql, de, elegida.respuesta, idComentario)
        cerrarReserva(sql, reserva.id, elegida.automatizacion, null)
        return
    }

    // Primero el privado, que es lo que la persona pidio. El aviso
    // publico va despues: si algo falla, que falle lo accesorio.
    const fallo = await responderComentario(idComentario, elegida.respuesta, quien.cred)
    if (elegida.avisoPublico?.trim()) {
        await avisarEnPublico(idComentario, elegida.avisoPublico, quien.cred)
    }

    cerrarReserva(sql, reserva.id, elegida.automatizacion, fallo, {
        respuesta: elegida.respuesta,
        aviso: elegida.avisoPublico?.trim() || null,
        // Todavia 'fija': la respuesta sale de la automatizacion. Cuando
        // entre la IA, este es el sitio donde cambia a 'ia' y donde se
        // anotan los tokens.
        origen: 'fija',
    })
}

// ── Mensajes ─────────────────────────────────────────────────────

async function atenderMensaje(
    m: EventoDeMensaje,
    canal: 'principal' | 'standby',
    quien: Quien,
    sql: SqlStorage,
): Promise<void> {
    const de = m.sender?.id
    if (!de) return

    // Los ecos son los mensajes que manda la propia cuenta. Sin filtrarlos
    // el bot entra en bucle consigo mismo.
    if (m.message?.is_echo === true) return

    // Un clic en un boton no es texto que la persona escribio: si se
    // tratara como tal, el titulo del boton podria disparar otro flujo
    // distinto. Va por su propio camino, que es seguir el que ya estaba
    // en marcha.
    //
    // Y un clic **cuenta como mensaje**, asi que abre la ventana de 24
    // horas: por eso desde aqui si se puede seguir con botones.
    const clic = m.postback?.payload ?? m.message?.quick_reply?.payload
    if (clic) {
        await atenderClic(clic, de, quien, sql)
        return
    }

    // Responder a una historia NO es un mensaje suelto: son dos
    // disparadores distintos, y en esta clase de cuentas casi todo entra
    // por el primero.
    const historia = m.message?.reply_to?.story?.id
    const texto = m.message?.text

    console.log(
        `[${quien.clave}] mensaje por ${canal} de ${de}` +
            (historia ? ` respondiendo a la historia ${historia}` : '') +
            `: ${JSON.stringify(texto ?? null)}`,
    )

    const elegida = historia
        ? buscarDisparador(sql, texto, 'historia', historia)
        : buscarDisparador(sql, texto, 'mensaje', undefined)

    if (!elegida) {
        guardarMensaje(sql, { de, texto, mediaId: historia, canal })
        return
    }

    contarDisparo(sql, elegida)

    // El mensaje se guarda **antes** de contestar, y es lo que abre la
    // ventana de 24 horas en nuestra propia cuenta: si el flujo pregunta
    // «¿puedo escribirle?» y este mensaje todavia no esta guardado, la
    // respuesta seria que no y no se mandaria nada.
    //
    // Se guarda el id porque hay que volver a esta fila cuando se sepa
    // como salio el envio. Ver el porque largo en `guardarMensaje()`.
    const idEvento = guardarMensaje(sql, {
        de,
        texto,
        mediaId: historia,
        canal,
        automatizacion: elegida.automatizacion,
    })

    // ¿Es un flujo o un mensaje suelto?
    //
    // Si la automatizacion tiene cajas, se manda el flujo, que puede
    // llevar botones porque la persona acaba de escribir y su ventana
    // esta abierta. Si no, se manda su respuesta de siempre.
    const caja = primeraCaja(sql, elegida.automatizacion, quien.clave)
    if (caja) {
        await mandarCajas(caja, de, quien, sql, idEvento, elegida.automatizacion)
        return
    }

    const permiso = sePuedeEscribirAlBuzon(ultimoMensajeDe(sql, de))
    if (!permiso.vale) {
        console.warn(`[${quien.clave}] no se le contesta a ${de}: ${permiso.motivo}`)
        cerrarReserva(sql, idEvento, elegida.automatizacion, permiso.motivo)
        return
    }
    if (!cabenEstaHora(sql, 1, quien.clave)) {
        // Se anota, y no es lo mismo que un fallo de Meta: quiere decir
        // que esta cuenta llego al tope de llamadas de esta hora y que a
        // esta persona **no se le contesto**.
        console.warn(`[${quien.clave}] no se le contesta a ${de}: no cabe esta hora`)
        cerrarReserva(sql, idEvento, elegida.automatizacion, 'no cabia en el tope de esta hora')
        return
    }

    const fallo = await responder(de, elegida.respuesta, quien.cred)
    if (fallo) console.error(`[${quien.clave}] fallo contestando a ${de}: ${fallo}`)
    cerrarReserva(sql, idEvento, elegida.automatizacion, fallo, {
        respuesta: elegida.respuesta,
        origen: 'fija',
    })
}

// ── Botones y cadenas de cajas ───────────────────────────────────

/**
 * Cuántas cajas se encadenan como mucho.
 *
 * Una caja puede llevar a otra sin que nadie pulse nada, para partir un
 * texto largo en dos mensajes o para mandar una despedida detrás de una
 * respuesta. Se sigue esa cadena hasta que se acaba, con un tope: un
 * flujo mal montado podría apuntarse a sí mismo y dejar al bot mandando
 * mensajes en bucle a una persona de verdad.
 */
const CAJAS_SEGUIDAS = 5

/** Alguien pulsó un botón: se sigue el flujo por donde lleve. */
async function atenderClic(
    payload: string,
    de: string,
    quien: Quien,
    sql: SqlStorage,
): Promise<void> {
    console.log(`[${quien.clave}] clic en ${payload} de ${de}`)

    // Se guarda igual que un mensaje: un clic es actividad de esa persona
    // y es lo que abre su ventana. Si no se guardara, el barrido de
    // pendientes creeria que no ha escrito nunca.
    const idEvento = guardarMensaje(sql, {
        de,
        texto: `[boton] ${payload}`,
        canal: 'principal',
    })

    const caja = cajaDelBoton(sql, payload, quien.clave)
    if (!caja) {
        // Puede pasar si alguien borro la caja destino desde el panel
        // mientras la conversacion estaba a medias. No es un error del
        // que haya que avisar a nadie, pero sin esta linea no habria
        // forma de entender por que el flujo se corto.
        console.warn(`[${quien.clave}] el boton ${payload} no lleva a ninguna caja`)
        cerrarReserva(sql, idEvento, null, 'el boton no lleva a ninguna caja')
        return
    }

    await mandarCajas(caja, de, quien, sql, idEvento, null)
}

/** Manda una caja y las que la siguen, respetando las reglas. */
async function mandarCajas(
    primera: Caja,
    de: string,
    quien: Quien,
    sql: SqlStorage,
    idEvento = 0,
    automatizacion: number | null = null,
): Promise<void> {
    let caja: Caja | null = primera

    // Lo que se le anota al evento al terminar. `null` es que salio bien.
    //
    // Se lleva en una variable y se escribe una sola vez al final porque
    // un flujo puede mandar varias cajas: lo que interesa saber despues
    // es si la persona recibio su respuesta, no cual de los cuatro
    // mensajes se atasco.
    let comoSalio: string | null = null

    for (let i = 0; i < CAJAS_SEGUIDAS && caja; i++) {
        // La ventana se comprueba **antes de cada caja**, no una vez al
        // principio: una cadena larga podria cruzar el borde, y mandar
        // fuera de la ventana no es un fallo tecnico, es romper una norma
        // de Meta en nombre del cliente.
        const permiso = sePuedeEscribirAlBuzon(ultimoMensajeDe(sql, de))
        if (!permiso.vale) {
            console.warn(`[${quien.clave}] no se sigue el flujo con ${de}: ${permiso.motivo}`)
            comoSalio = permiso.motivo
            break
        }

        if (!cabenEstaHora(sql, 1, quien.clave)) {
            console.warn(`[${quien.clave}] el flujo con ${de} se corta: no cabe esta hora`)
            comoSalio = 'no cabia en el tope de esta hora'
            break
        }

        const fallo = caja.botones.length
            ? await responderConBotones(de, caja.texto, caja.botones, quien.cred, quien.clave)
            : await responder(de, caja.texto, quien.cred)

        if (fallo) {
            console.error(`[${quien.clave}] fallo mandando la caja ${caja.id}: ${fallo}`)
            comoSalio = fallo
            break
        }

        // Si la caja tiene botones, la conversacion se para aqui a
        // esperar: seguir encadenando detras de unos botones dejaria a la
        // persona con dos mensajes y sin saber cual contestar.
        if (caja.botones.length) break

        caja = caja.siguiente ? cajaPorId(sql, caja.siguiente, quien.clave) : null
    }

    cerrarReserva(sql, idEvento, automatizacion, comoSalio, {
        respuesta: primera.texto,
        origen: 'fija',
    })
}
