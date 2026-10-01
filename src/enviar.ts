/**
 * Lo único que sale hacia Meta.
 *
 * ── El token es del cliente, no nuestro ────────────────────────────
 *
 * Por eso todas las funciones de aquí lo reciben por parámetro, igual
 * que la base. Ese token se lo dio el cliente a la app al conectar su
 * cuenta y deja de valer en cuanto la desconecte: no hay un token de la
 * plataforma que sirva para todos.
 *
 * ── Los topes, de la documentación de Meta ─────────────────────────
 *
 *   - **Respuesta privada** a un comentario: **750 por hora y por
 *     cuenta**, y **una sola por comentario**.
 *   - Mensajes (texto, enlaces, reacciones): 100 por segundo.
 *   - Conversaciones: 2 por segundo.
 *   - General: `llamadas en 24 h = 4800 × impresiones`.
 *
 * La **respuesta pública** a un comentario no tiene techo propio
 * publicado: cae bajo el general, que con una cuenta de cierto tamaño es
 * holgadísimo.
 *
 * ── Y el que no está en la documentación ───────────────────────────
 *
 * El largo del mensaje. Una respuesta privada admite **640 caracteres** y
 * un mensaje dentro de la ventana de 24 horas, **1000**. Como casi todo
 * sale por la primera vía, el tope que se aplica es 640: lo que quepa ahí
 * cabe en las dos.
 */

// Los topes de largo y de botones ya no viven aqui: los decide
// `ventanas.ts`, que es el unico sitio que sabe las reglas de Meta.
import {
    ajustarBotones,
    recortar,
    LARGO_PRIVADO,
    LARGO_MENSAJE,
    type Boton,
} from './ventanas'

/**
 * Con qué y **por dónde** se le habla a Meta en nombre de un cliente.
 *
 * ── Por qué esto es un tipo y no el token suelto ───────────────────
 *
 * Porque un token, solo, **no basta para saber a quién llamar**, y ésa
 * fue exactamente la trampa que costó una tarde entera el 23/09/2026 y
 * que está contada en el README («Two Meta login flows»).
 *
 * Meta tiene dos configuraciones excluyentes, y cuál toca **lo decide
 * cómo tenga montada su cuenta el cliente**, no nosotros:
 *
 * | Si el cliente tiene   | El token es        | Se llama a            |
 * |-----------------------|--------------------|-----------------------|
 * | sólo Instagram        | suyo, de la cuenta | `graph.instagram.com` |
 * | Instagram + Página FB | de la **Página**   | `graph.facebook.com`  |
 *
 * Cruzarlos no da un error que se entienda. Un token de Instagram contra
 * el host de Facebook contesta *«Invalid OAuth access token - Cannot
 * parse access token»*, que suena a token caducado; y al revés sale un
 * `code 100: Unsupported request`, que suena a endpoint mal escrito. Las
 * dos veces se busca durante horas por donde no es.
 *
 * ── Por qué son dos formas y no un objeto con campos opcionales ────
 *
 * Porque el flujo de Facebook necesita **una cosa más** —el id de la
 * Página, que es a quien pertenece el token— y con campos opcionales se
 * podría armar un envío por Facebook sin ella y no enterarse hasta que
 * fallara delante de un cliente. Así, el compilador no deja.
 */
export type Credencial =
    | { flujo: 'instagram'; token: string }
    | { flujo: 'facebook'; token: string; pagina: string }

/**
 * Las dos puertas. La versión va junta a propósito: subirla es un acto
 * único para todo el producto, no una decisión por llamada.
 */
const HOST = {
    instagram: 'https://graph.instagram.com/v23.0',
    facebook: 'https://graph.facebook.com/v23.0',
} as const

/**
 * Contra qué identidad se manda un mensaje.
 *
 * Con Instagram Login el token **es** la cuenta, así que `me` la
 * resuelve. Con Facebook Login el token es de la Página, y Meta lo
 * documenta con el id delante:
 *
 * > *«POST https://graph.facebook.com/PAGE_ID/messages … a page access
 * > token requested by an Instagram user who can perform the MESSAGING
 * > task on the Facebook Page»*
 *
 * Con un token de Página, `me` también resolvería a la Página y saldría
 * igual. Se escribe el id de todas formas porque lo tenemos guardado y
 * porque, el día que algo falle, saber contra qué Página se llamó ahorra
 * la pregunta.
 */
function buzonDe(cred: Credencial): string {
    return cred.flujo === 'facebook' ? cred.pagina : 'me'
}

/**
 * La respuesta privada a un comentario.
 *
 * Es el mismo endpoint que el de mandar un mensaje, pero el destinatario
 * se nombra distinto: `comment_id` en vez de `id`. Meta lo traduce solo a
 * quien escribió ese comentario, así que no hace falta saber quién es.
 *
 * ── Por qué ésta es la vía privilegiada ────────────────────────────
 *
 * **No necesita acceso avanzado.** Un mensaje directo normal sí, y sin
 * él Meta devuelve un 403 diciendo que el destinatario no tiene rol en la
 * app. O sea que, hasta que un cliente tenga el permiso aprobado, esto es
 * literalmente lo único que se le puede mandar a alguien que no conoce de
 * antes.
 *
 * Devuelve `null` si salió bien, o el error como texto. No lanza: una
 * respuesta que falla no puede impedir las treinta siguientes.
 */
export async function responderComentario(
    idComentario: string,
    texto: string,
    cred: Credencial,
): Promise<string | null> {
    return await mandar(cred, {
        recipient: { comment_id: idComentario },
        message: { text: recortar(texto, LARGO_PRIVADO) },
    })
}

/**
 * Un mensaje directo normal, al buzón de la persona.
 *
 * ── Qué pide, comprobado el 21/09/2026 ─────────────────────────────
 *
 * Con **acceso estándar** funciona sobre cuentas propias o añadidas a la
 * app: se probó contra una cuenta propia y salió, tanto texto solo como
 * un mensaje con botones.
 *
 * Para las cuentas de **clientes**, que no son nuestras, Meta pide
 * **acceso avanzado**: *«Advanced Access if your app serves Instagram
 * professional accounts you don't own or manage»*. O sea que el App
 * Review no es opcional para vender esto, aunque hoy funcione en pruebas.
 *
 * ── La ventana de 24 horas manda ───────────────────────────────────
 *
 * Esto sólo se puede dentro de las 24 horas siguientes a que la persona
 * **escriba un mensaje**. Un comentario no abre esa ventana; la respuesta
 * privada a un comentario va por otra puerta y tiene 7 días.
 */
export async function responder(
    destinatario: string,
    texto: string,
    cred: Credencial,
): Promise<string | null> {
    return await mandar(cred, {
        recipient: { id: destinatario },
        message: { text: recortar(texto, LARGO_MENSAJE) },
    })
}

/**
 * El aviso público bajo el comentario.
 *
 * ── Por qué no es duplicar el mensaje ──────────────────────────────
 *
 * Porque el privado de un negocio a alguien que no lo sigue **cae en
 * Solicitudes de mensajes**, donde no avisa. Sin esta línea se pierde
 * toda la gente que no revisa esa bandeja, que es casi toda.
 *
 * ── Y por qué van varios textos separados por «|» ──────────────────
 *
 * Porque la misma frase repetida cincuenta veces bajo cincuenta
 * comentarios es exactamente lo que hace que un perfil parezca un robot,
 * y lo que despierta los controles antispam que Meta no publica.
 *
 * ── El camino es el mismo en los dos flujos; el host, no ───────────
 *
 * De la documentación de moderación de comentarios de Meta: el path
 * `/IG_COMMENT_ID/replies` es idéntico con Instagram Login y con Facebook
 * Login, y la diferencia está **sólo** en a qué host se llama. Por eso
 * aquí no hay ninguna rama: basta con preguntarle a la credencial.
 */
export async function avisarEnPublico(
    idComentario: string,
    avisos: string | null,
    cred: Credencial,
): Promise<string | null> {
    if (!avisos) return null
    const opciones = avisos.split('|').map((a) => a.trim()).filter(Boolean)
    if (opciones.length === 0) return null

    if (!cred.token) {
        console.warn('[publico] hay que avisar pero el cliente no tiene token')
        return 'el cliente no tiene token'
    }

    const elegido = opciones[Math.floor(Math.random() * opciones.length)]

    const res = await fetch(
        `${HOST[cred.flujo]}/${idComentario}/replies?access_token=${cred.token}`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: elegido }),
        },
    )
    const cuerpo = await res.text()
    if (!res.ok) {
        console.error(
            `[publico] fallo el aviso en ${idComentario} por ${cred.flujo} (HTTP ${res.status}): ${cuerpo}`,
        )
        return `HTTP ${res.status}: ${cuerpo.slice(0, 200)}`
    }
    console.log(`[publico] avisado bajo ${idComentario}: ${JSON.stringify(elegido)}`)
    return null
}

/**
 * El POST, con el manejo de errores en un solo sitio.
 *
 * El flujo va escrito en el registro de los fallos a propósito: los dos
 * errores más caros de este producto —el token contra el host
 * equivocado— se diagnostican en un segundo si la línea del error dice
 * por dónde salió, y cuestan horas si no lo dice.
 */
async function mandar(cred: Credencial, cuerpo: unknown): Promise<string | null> {
    if (!cred.token) {
        console.warn('[enviar] hay que contestar pero el cliente no tiene token')
        return 'el cliente no tiene token'
    }

    const url = `${HOST[cred.flujo]}/${buzonDe(cred)}/messages?access_token=${cred.token}`

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo),
    })
    const texto = await res.text()

    if (!res.ok) {
        console.error(`[enviar] fallo por ${cred.flujo} (HTTP ${res.status}): ${texto}`)
        return `HTTP ${res.status}: ${texto.slice(0, 200)}`
    }
    console.log(`[enviar] enviado por ${cred.flujo}: ${texto.slice(0, 120)}`)
    return null
}


/**
 * Un mensaje al buzón **con botones**.
 *
 * ── Por qué esto no sirve para contestar un comentario ─────────────
 *
 * Porque los botones sólo viajan por la puerta del buzón, contra el id
 * de la persona, y esa puerta sólo se abre cuando **ella escribe un
 * mensaje**. Un comentario no la abre.
 *
 * De ahí sale la forma que tienen los flujos aquí, y conviene entenderla
 * antes de diseñar uno: quien comenta recibe primero un mensaje **de
 * texto**, y los botones sólo aparecen si contesta. No es una limitación
 * nuestra y no hay forma de saltársela.
 *
 * ── Los botones se ajustan, no se rechazan ─────────────────────────
 *
 * Tres como mucho, veinte caracteres de título. Si vienen más o más
 * largos se recortan y se deja dicho en el registro, en vez de no mandar
 * nada: perder el cuarto botón es un problema pequeño; no contestar,
 * uno grande delante de alguien que está esperando.
 */
export async function responderConBotones(
    destinatario: string,
    texto: string,
    botones: Boton[],
    cred: Credencial,
    cliente: string,
): Promise<string | null> {
    const puestos = ajustarBotones(botones, cliente)
    if (!puestos.length) {
        // Sin botones válidos se manda el texto solo. Es mejor que nada y
        // que un error: la persona recibe la información igual.
        return await responder(destinatario, texto, cred)
    }

    return await mandar(cred, {
        recipient: { id: destinatario },
        message: {
            attachment: {
                type: 'template',
                payload: {
                    template_type: 'button',
                    text: recortar(texto, LARGO_MENSAJE),
                    // Los dos tipos que admite Instagram. El de enlace
                    // abre una direccion y ahi termina; el de aviso
                    // vuelve al bot y sigue el flujo.
                    buttons: puestos.map((b) =>
                        b.url
                            ? { type: 'web_url', url: b.url, title: b.titulo }
                            : { type: 'postback', payload: b.payload, title: b.titulo },
                    ),
                },
            },
        },
    })
}
