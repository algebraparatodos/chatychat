/**
 * Las reglas de Instagram sobre a quién se puede escribir y cuándo.
 *
 * ⚠️ **ESTE ES EL ÚNICO ARCHIVO QUE DECIDE SI UN ENVÍO ESTÁ PERMITIDO.**
 *
 * Todo lo que manda algo tiene que preguntar aquí primero. No es
 * purismo: son las normas de Meta, y romperlas no da un error técnico
 * sino que **le cuesta la cuenta al cliente**. Un negocio que pierde la
 * mensajería de Instagram pierde el canal por el que vende, y lo pierde
 * por algo que hicimos nosotros en su nombre.
 *
 * Por eso están escritas aquí, juntas, con su porqué y su fecha, en vez
 * de repartidas en comprobaciones sueltas dentro de cada función. Si
 * mañana Meta cambia un plazo, se cambia aquí y se acabó.
 *
 * ── Las tres puertas, que no son intercambiables ───────────────────
 *
 * Instagram no tiene «mandar un mensaje». Tiene tres formas distintas de
 * hacerlo, cada una con su plazo y su límite, y confundirlas es el error
 * que más caro sale:
 *
 *   1. RESPUESTA PRIVADA A UN COMENTARIO
 *      Se manda contra el id del comentario. Plazo: 7 días desde que se
 *      comentó. **Una sola por comentario, nunca dos.** No admite
 *      botones.
 *
 *   2. MENSAJE AL BUZÓN
 *      Se manda contra el id de la persona. Sólo dentro de las 24 horas
 *      siguientes a que **ella escriba un mensaje**. Admite botones.
 *
 *   3. RESPUESTA PÚBLICA BAJO EL COMENTARIO
 *      No es un mensaje y no tiene ventana, pero sí cuenta para el tope
 *      de llamadas por hora.
 *
 * **Un comentario NO abre la ventana de 24 horas.** Sólo la abre un
 * mensaje. Un clic en un botón sí cuenta como mensaje.
 *
 * ── De dónde salen estos números ───────────────────────────────────
 *
 * De la documentación de Meta, medidos el 19/09/2026 para el bot que dio
 * origen a esto y comprobados otra vez el 21/09/2026. Los de largo de
 * texto y botones salen además del editor de ManyChat, que es lo que
 * Meta acepta de verdad en la práctica.
 */

/** Plazo para responder en privado a un comentario. */
export const DIAS_PARA_RESPONDER_UN_COMENTARIO = 7

/** Plazo para escribirle a alguien que mandó un mensaje. */
export const HORAS_DE_VENTANA = 24

/**
 * Cuánto margen se deja antes del borde de la ventana.
 *
 * **Criterio nuestro, no norma.** Un envío que sale en el último segundo
 * puede llegar tarde y lo rechazan; eso se anota como fallo y ensucia el
 * registro de algo que en realidad es «llegó tarde». Diez minutos.
 */
export const MARGEN_MINUTOS = 10

/** Caracteres de una respuesta privada a un comentario. */
export const LARGO_PRIVADO = 640

/** Caracteres de un mensaje dentro de la ventana de 24 horas. */
export const LARGO_MENSAJE = 1000

/** Botones por mensaje. Al cuarto, Instagram lo rechaza. */
export const BOTONES_POR_MENSAJE = 3

/** Caracteres del título de un botón. */
export const LARGO_BOTON = 20

/** Respuestas privadas por comentario. Una, y no es negociable. */
export const PRIVADOS_POR_COMENTARIO = 1

// ── Las decisiones ────────────────────────────────────────────────

export type Puerta = 'privado' | 'buzon' | 'publico'

export type Permiso =
    | { vale: true; largoMaximo: number; admiteBotones: boolean }
    | { vale: false; motivo: string }

/**
 * ¿Se puede responder en privado a este comentario?
 *
 * `cuandoSeComento` es lo que manda, no cuándo lo recibimos nosotros. Un
 * webhook puede llegar tarde o reintentarse al día siguiente, y lo que
 * cuenta para Meta es la fecha del comentario.
 */
export function sePuedeResponderAlComentario(cuandoSeComento: Date | null): Permiso {
    if (!cuandoSeComento) {
        // Sin fecha se permite, y es deliberado: casi todos los
        // comentarios llegan por webhook a los segundos de escribirse.
        // Bloquear por no saber la fecha dejaría sin contestar el caso
        // normal para protegerse del raro.
        return { vale: true, largoMaximo: LARGO_PRIVADO, admiteBotones: false }
    }

    const limite = cuandoSeComento.getTime() + DIAS_PARA_RESPONDER_UN_COMENTARIO * 86_400_000
    if (Date.now() >= limite) {
        return {
            vale: false,
            motivo: `el comentario tiene mas de ${DIAS_PARA_RESPONDER_UN_COMENTARIO} dias, ya no admite respuesta privada`,
        }
    }
    // La respuesta privada **no admite botones**. Es el motivo de que un
    // flujo con botones no pueda empezar en un comentario: el primer
    // mensaje va sin ellos, y los botones sólo caben si la persona
    // contesta y abre la ventana.
    return { vale: true, largoMaximo: LARGO_PRIVADO, admiteBotones: false }
}

/**
 * ¿Se le puede escribir al buzón de esta persona?
 *
 * `ultimoMensajeSuyo` es cuándo escribió ella por última vez. Si nunca
 * escribió, **no se le puede escribir**, y eso no es un fallo: es la
 * norma. Mandar fuera de la ventana no sólo se rechaza, cuenta como
 * escribirle a quien no dio pie.
 */
export function sePuedeEscribirAlBuzon(ultimoMensajeSuyo: Date | null): Permiso {
    if (!ultimoMensajeSuyo) {
        return { vale: false, motivo: 'esa persona nunca mando un mensaje, solo se le puede contestar a un comentario' }
    }

    const limite =
        ultimoMensajeSuyo.getTime() + (HORAS_DE_VENTANA * 60 - MARGEN_MINUTOS) * 60_000
    if (Date.now() >= limite) {
        return {
            vale: false,
            motivo: `la ventana de ${HORAS_DE_VENTANA} horas ya se cerro`,
        }
    }
    return { vale: true, largoMaximo: LARGO_MENSAJE, admiteBotones: true }
}

// ── Lo que se manda, recortado a lo que Meta admite ───────────────

/**
 * Recorta un texto al largo de la puerta por la que va a salir.
 *
 * Se recorta **por palabra** y con puntos suspensivos. Cortar a mitad de
 * palabra queda mal en un mensaje que le llega a un cliente de un
 * cliente, y es de las cosas que hacen que un bot parezca un bot.
 */
export function recortar(texto: string, largoMaximo: number): string {
    const limpio = texto.trim()
    if (limpio.length <= largoMaximo) return limpio

    const corte = limpio.slice(0, largoMaximo - 1)
    const espacio = corte.lastIndexOf(' ')
    return `${(espacio > largoMaximo * 0.6 ? corte.slice(0, espacio) : corte).trimEnd()}…`
}

/**
 * Un botón, de los dos tipos que Instagram admite.
 *
 * El de **enlace** abre una dirección y ahí termina; el de **ir** manda
 * un aviso de vuelta al bot y continúa el flujo. Se distinguen por cuál
 * de los dos campos viene relleno.
 */
export type Boton =
    | { titulo: string; payload: string; url?: undefined }
    | { titulo: string; url: string; payload?: undefined }

/**
 * Deja la lista de botones como Instagram la acepta.
 *
 * Tres como mucho y veinte caracteres de título. Se recorta en vez de
 * rechazar el envío entero: perder el cuarto botón es un problema
 * pequeño, y no mandar nada porque alguien puso uno de más es un
 * problema grande delante de una persona esperando respuesta.
 *
 * Lo que sí se registra es que se recortó, para que se pueda arreglar en
 * el panel en vez de descubrirlo por una queja.
 */
export function ajustarBotones(botones: Boton[], cliente: string): Boton[] {
    if (botones.length > BOTONES_POR_MENSAJE) {
        console.warn(
            `[ventanas] «${cliente}» tiene ${botones.length} botones en una caja y Instagram` +
                ` admite ${BOTONES_POR_MENSAJE}: se mandan los primeros`,
        )
    }
    return botones.slice(0, BOTONES_POR_MENSAJE).map((b) => {
        const titulo = b.titulo.trim()
        if (titulo.length > LARGO_BOTON) {
            console.warn(
                `[ventanas] «${cliente}» tiene un boton de ${titulo.length} caracteres y el` +
                    ` tope es ${LARGO_BOTON}: «${titulo}»`,
            )
        }
        const corto = titulo.slice(0, LARGO_BOTON)
        return b.url ? { titulo: corto, url: b.url } : { titulo: corto, payload: b.payload! }
    })
}

/** Convierte lo que guarda la base en una fecha, o `null` si no se puede. */
export function fechaDe(texto: string | null | undefined): Date | null {
    if (!texto) return null
    // Las fechas de la base vienen como 'YYYY-MM-DD HH:MM:SS' en UTC.
    const t = Date.parse(texto.includes('T') ? texto : `${texto.replace(' ', 'T')}Z`)
    return Number.isNaN(t) ? null : new Date(t)
}
