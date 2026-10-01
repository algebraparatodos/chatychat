/**
 * De dónde sale la base de cada cliente.
 *
 * ⚠️ **ESTE ES EL ÚNICO ARCHIVO DE TODO EL PROYECTO QUE LO SABE.**
 *
 * Todo lo demás recibe la base por parámetro. Si alguna vez ves un
 * `env.ALGO.prepare(...)` dentro de una consulta, está roto aunque
 * funcione: lo que se rompe no es el código, es la posibilidad de
 * cambiar de idea. El porqué está en el
 * README («Data isolation»), y en dos líneas es esto:
 *
 * Un Worker **no puede abrir una base D1 arbitraria en tiempo de
 * ejecución**. Los enlaces se declaran en `wrangler.jsonc` y se
 * resuelven al desplegar. Así que «una base por cliente» significa hoy
 * «un enlace declarado por cliente», y dar de alta a uno obliga a
 * redesplegar.
 *
 * El día que eso duela se pasa a un Durable Object por cliente, que se
 * crea por nombre y no necesita redespliegue. Ese día **se cambia este
 * archivo y nada más**, siempre que nadie haya metido un enlace directo
 * en otro sitio.
 */

import type { Env } from './entorno'
import type { Credencial } from './enviar'
export type { Env }
export type { Credencial }

/** Un cliente de la plataforma, tal como vive en la base de control. */
export type Ficha = {
    /** La clave corta, que es la que forma el nombre del enlace. */
    clave: string
    nombre: string
    /** El id de la cuenta de Instagram, que es por donde llega el webhook. */
    cuenta_ig: string
    /**
     * El token de Instagram Login, con el que se le responde. Es suyo, no
     * nuestro. **Vacío en los clientes del flujo de Facebook**, que no
     * tienen token de Instagram: los suyos son los dos de abajo.
     */
    token: string
    /** 'alta', 'pausa' o 'baja'. Sólo se atiende a los de alta. */
    estado: string
    /**
     * Por cuál de los dos flujos de Meta va este cliente. Nulo en los que
     * se conectaron antes de que existieran los dos, que son todos de
     * Instagram Login: ése es el valor por defecto en `credencialDe`.
     */
    flujo?: 'instagram' | 'facebook' | null
    /** El token de la Página. Sólo en el flujo de Facebook. */
    token_pagina?: string | null
    /** A qué Página pertenece ese token. Sólo en el flujo de Facebook. */
    pagina_fb?: string | null
    /** Cuándo se renovó su token. Nulo si nunca. */
    token_renovado?: string | null
    /** 'bien', o el nombre de lo que está roto. */
    salud?: string
}

/**
 * Las columnas que hacen falta para poder hablarle a un cliente.
 *
 * En una constante y no repetidas en cada consulta porque olvidarse de
 * una aquí **no da ningún error**: la ficha llega con el campo a
 * `undefined`, `credencialDe` cae al flujo de Instagram por defecto, y el
 * síntoma es que a un cliente con Página le fallan todos los envíos con
 * un error de Meta que habla de tokens. Ya costó una tarde una vez.
 */
const COLUMNAS_PARA_HABLARLE = `clave, nombre, cuenta_ig, token, estado,
                                flujo, token_pagina, pagina_fb`

/**
 * Con qué credencial se le habla a este cliente, o `null` si con ninguna.
 *
 * ── Por qué esto vive aquí y no en `enviar.ts` ─────────────────────
 *
 * Porque es la traducción de **una fila de la base de control** a lo que
 * entiende el envío, y este archivo es el único que sabe de esa base.
 * `enviar.ts` define la forma; éste la rellena. Así hay un solo sitio
 * donde se decide, y no una rama `if (flujo === ...)` repartida por el
 * Worker que algún día alguien actualice a medias.
 *
 * ── Por qué puede devolver `null` ──────────────────────────────────
 *
 * Porque un cliente puede estar a medio conectar: marcado como de
 * Facebook pero sin el token de la Página o sin el id, que es lo que
 * pasaría si el canje se cortara por la mitad. Devolver una credencial
 * de Instagram en ese caso sería lo peor de todo: el envío saldría
 * contra el host equivocado y el error de Meta no diría nada de esto.
 * Mejor no mandar y que quede dicho por qué.
 */
export function credencialDe(ficha: Ficha): Credencial | null {
    if (ficha.flujo === 'facebook') {
        if (!ficha.token_pagina || !ficha.pagina_fb) return null
        return { flujo: 'facebook', token: ficha.token_pagina, pagina: ficha.pagina_fb }
    }
    // Todo lo demás es Instagram Login, incluidos los clientes que se
    // conectaron antes de que la columna `flujo` existiera.
    if (!ficha.token) return null
    return { flujo: 'instagram', token: ficha.token }
}


/**
 * Qué cliente es dueño de la cuenta de Instagram por la que llegó el aviso.
 *
 * -- Por qué se busca por la cuenta y no por otra cosa --------------
 *
 * Porque es lo único que Meta manda. Un webhook trae `entry[].id`, que
 * es el identificador de la cuenta de Instagram que recibió el
 * comentario o el mensaje. No trae nada nuestro: ni un cliente, ni una
 * clave, ni la app. **La cuenta es la única llave que tenemos.**
 *
 * De ahí sale una consecuencia que conviene tener presente: dos clientes
 * no pueden compartir cuenta de Instagram. Si algún día pasara, este
 * es el sitio donde se notaría.
 */
export async function clienteDeLaCuenta(
    cuentaIg: string,
    env: Env,
): Promise<Ficha | null> {
    const fila = await env.CONTROL.prepare(
        `SELECT ${COLUMNAS_PARA_HABLARLE}
           FROM clientes
          WHERE cuenta_ig = ?1 AND estado = 'alta'`,
    )
        .bind(cuentaIg)
        .first<Ficha>()
    return fila ?? null
}

/**
 * Todos los clientes que hay que atender.
 *
 * La usa el cron, que no viene de un webhook y por tanto no tiene una
 * cuenta de la que partir: tiene que recorrerlos todos.
 *
 * ── Por qué vive aquí y no en el cron ──────────────────────────────
 *
 * Porque es una consulta a la base de control, y este es el único
 * archivo al que se le permite sacar una base de la configuración. Si
 * estuviera en `index.ts`, el guardián de `herramientas/` saltaría, y
 * con razón: sería la primera grieta por la que se cuela el resto.
 */
export async function clientesDeAlta(env: Env): Promise<Ficha[]> {
    const { results } = await env.CONTROL.prepare(
        `SELECT ${COLUMNAS_PARA_HABLARLE}, token_renovado, salud
           FROM clientes
          WHERE estado = 'alta'
          ORDER BY clave`,
    ).all<Ficha>()
    return results ?? []
}

/**
 * Un cliente por su clave, sea cual sea su estado.
 *
 * A diferencia de `clienteDeLaCuenta`, esta **no filtra por estado**, y
 * es a propósito: la usa la conexión de una cuenta, y un cliente que
 * está conectando su cuenta por primera vez está justamente en pausa.
 * Filtrar aquí haría que el único momento en que hace falta buscarlo
 * fuera el único en que no se encuentra.
 */
export async function clientePorClave(clave: string, env: Env): Promise<Ficha | null> {
    const fila = await env.CONTROL.prepare(
        `SELECT ${COLUMNAS_PARA_HABLARLE}
           FROM clientes
          WHERE clave = ?1`,
    )
        .bind(clave)
        .first<Ficha>()
    return fila ?? null
}

/**
 * Guarda el token de un cliente y lo deja atendido.
 *
 * ── Por qué esto también lo pone de alta ───────────────────────────
 *
 * Porque conectar la cuenta es exactamente lo que le faltaba. Un cliente
 * nace en pausa por no tener token; en cuanto lo tiene, no hay ningún
 * otro momento natural en que alguien vaya a acordarse de encenderlo, y
 * un cliente que conectó su cuenta y no recibe respuestas es un fallo
 * que se descubre tarde y mal.
 *
 * ── La cuenta se guarda, no se comprueba ───────────────────────────
 *
 * El id de la cuenta lo dice Instagram al terminar el canje, y **manda
 * ése**, no el que estuviera apuntado. Al dar de alta se escribe a mano
 * y a mano se teclea mal; lo que llega del canje es lo que de verdad va
 * a venir después en cada webhook, que es lo único que importa.
 */
export async function guardarTokenDelCliente(
    clave: string,
    token: string,
    cuentaIg: string,
    env: Env,
): Promise<void> {
    await env.CONTROL.batch([
        env.CONTROL.prepare(
            // `salud = 'bien'` y `salud_desde` se reponen aquí a
            // propósito. Si el cliente había desconectado la app, el aviso
            // de Meta le dejó la salud en 'token'; volver a conectar la
            // arregla de verdad, pero sin esta línea la marca se quedaba
            // puesta hasta la pasada diaria siguiente. Durante ese rato el
            // panel y los avisos dirían que está roto un cliente que
            // acaba de conectar delante de nuestros ojos.
            //
            // Se vio el 24/09/2026 grabando el vídeo del App Review, que
            // pasa justo por desconectar y volver a conectar.
            `UPDATE clientes
                SET token = ?2, cuenta_ig = ?3, estado = 'alta',
                    salud = 'bien', salud_desde = datetime('now'),
                    actualizado = datetime('now')
              WHERE clave = ?1`,
        ).bind(clave, token, cuentaIg),
        env.CONTROL.prepare(
            `INSERT INTO movimientos (cliente, tipo, detalle)
             VALUES (?1, 'token', ?2)`,
        ).bind(clave, `cuenta ${cuentaIg} conectada, token de 60 dias`),
    ])
}

/**
 * Deja constancia de algo que le pasó a un cliente.
 *
 * Existe para los fallos de la conexión: un canje que no sale tiene que
 * quedar escrito en algún sitio que se pueda mirar después, porque el
 * cliente sólo va a decir «le di a conectar y no pasó nada».
 */
export async function anotarMovimiento(
    clave: string,
    tipo: string,
    detalle: string,
    env: Env,
): Promise<void> {
    try {
        await env.CONTROL.prepare(
            `INSERT INTO movimientos (cliente, tipo, detalle) VALUES (?1, ?2, ?3)`,
        )
            .bind(clave, tipo, detalle)
            .run()
    } catch (err) {
        console.error(`[control] no se pudo anotar el movimiento de ${clave}: ${err}`)
    }
}

/**
 * Guarda el token recién renovado y la fecha.
 *
 * La fecha es lo que decide cuándo toca la próxima, así que se escriben
 * juntos: si se guardara el token y la fecha se perdiera, el cliente
 * quedaría renovándose cada día, y si se guardara la fecha sin el token,
 * quedaría con uno viejo y una fecha que dice que está fresco, que es
 * mucho peor.
 */
export async function guardarRenovacion(
    clave: string,
    token: string,
    env: Env,
): Promise<void> {
    await env.CONTROL.prepare(
        `UPDATE clientes
            SET token = ?2, token_renovado = datetime('now'),
                actualizado = datetime('now')
          WHERE clave = ?1`,
    )
        .bind(clave, token)
        .run()
}

/** Cómo está hoy un cliente: 'bien', o el nombre de lo que está roto. */
export async function guardarSalud(clave: string, salud: string, env: Env): Promise<void> {
    await env.CONTROL.prepare(
        `UPDATE clientes
            SET salud = ?2, salud_desde = datetime('now')
          WHERE clave = ?1`,
    )
        .bind(clave, salud)
        .run()
}

/**
 * Las marcas de lo que corre una vez al día.
 *
 * El cron va cada cinco minutos porque eso necesitan los mensajes
 * programados. Lo diario se controla con una marca en la base en vez de
 * con un segundo cron: así, si el Worker estuvo caído, al volver ve que
 * la marca es vieja y lo hace, en lugar de esperar a la hora exacta del
 * día siguiente.
 */
export async function leerMarca(clave: string, env: Env): Promise<string | null> {
    try {
        const fila = await env.CONTROL.prepare(
            `SELECT valor FROM plataforma WHERE clave = ?1`,
        )
            .bind(clave)
            .first<{ valor: string }>()
        return fila?.valor ?? null
    } catch (err) {
        // Si no se puede leer la marca, se devuelve `null`, o sea «hace
        // mucho». Es la dirección segura: peor que una revisión se
        // repita es que no se haga nunca.
        console.error(`[control] no se pudo leer la marca ${clave}: ${err}`)
        return null
    }
}

export async function escribirMarca(clave: string, env: Env): Promise<void> {
    try {
        await env.CONTROL.prepare(
            `INSERT INTO plataforma (clave, valor) VALUES (?1, datetime('now'))
             ON CONFLICT(clave) DO UPDATE SET valor = datetime('now')`,
        )
            .bind(clave)
            .run()
    } catch (err) {
        console.error(`[control] no se pudo escribir la marca ${clave}: ${err}`)
    }
}

/**
 * Apunta una solicitud de borrado de datos.
 *
 * Vive en la base de la plataforma y no en la del cliente a propósito:
 * una solicitud tiene que **sobrevivir al borrado de lo que pide
 * borrar**. Si viviera en la base del cliente, atenderla destruiría el
 * registro de haberla atendido, que es justo lo que hay que poder
 * enseñar si alguien pregunta.
 */
export async function apuntarBorrado(
    codigo: string,
    quien: string,
    cliente: string | null,
    env: Env,
): Promise<void> {
    try {
        await env.CONTROL.prepare(
            `INSERT INTO borrados (codigo, quien, cliente) VALUES (?1, ?2, ?3)`,
        )
            .bind(codigo, quien, cliente)
            .run()
    } catch (err) {
        // Se registra y se sigue: a Meta hay que contestarle igual, y
        // perder el aviso por correo es peor que perder la fila.
        console.error(`[control] no se pudo apuntar el borrado ${codigo}: ${err}`)
    }
}

export type Borrado = { estado: string; recibida: string; terminada: string | null }

/** El estado de una solicitud, para la página que consulta la persona. */
export async function estadoDelBorrado(codigo: string, env: Env): Promise<Borrado | null> {
    try {
        const fila = await env.CONTROL.prepare(
            `SELECT estado, recibida, terminada FROM borrados WHERE codigo = ?1`,
        )
            .bind(codigo)
            .first<Borrado>()
        return fila ?? null
    } catch (err) {
        console.error(`[control] no se pudo leer el borrado ${codigo}: ${err}`)
        return null
    }
}

/**
 * Deja anotado por cuál de los dos flujos de Meta va este cliente.
 *
 * ── Por qué se guarda en vez de averiguarlo cada vez ───────────────
 *
 * Porque **no se puede saber antes de que la persona autorice**. Nadie
 * sabe, ni tiene por qué saber, si su Instagram está enlazado a una
 * Página de Facebook, así que preguntárselo en el formulario sería
 * trasladarle a él un problema nuestro.
 *
 * Lo que sí se puede es deducirlo del primer intento: si el token de
 * Instagram Login no resuelve su cuenta, es que tiene Página. Eso se
 * anota aquí y ya no hace falta volver a averiguarlo: la próxima vez se
 * le manda directo por el camino bueno.
 */
export async function marcarFlujo(
    clave: string,
    flujo: 'instagram' | 'facebook',
    env: Env,
): Promise<void> {
    try {
        await env.CONTROL.prepare(
            `UPDATE clientes SET flujo = ?2, actualizado = datetime('now') WHERE clave = ?1`,
        )
            .bind(clave, flujo)
            .run()
    } catch (err) {
        console.error(`[control] no se pudo marcar el flujo de «${clave}»: ${err}`)
    }
}

/**
 * Guarda lo que hace falta para atender a un cliente por Facebook Login.
 *
 * ── Por qué son cuatro cosas y no una ──────────────────────────────
 *
 * Con Instagram Login bastaba el token: se hablaba con la cuenta y ya.
 * Aquí no. Se habla **con la Página**, que es quien tiene el token, pero
 * los webhooks siguen llegando identificados por la **cuenta de
 * Instagram**. Así que hacen falta las dos cosas y hay que no
 * confundirlas:
 *
 *   `token_pagina` con qué se manda
 *   `pagina_fb`    a quién pertenece ese token
 *   `cuenta_ig`    con qué se le reconoce cuando llega un evento
 *   `flujo`        por cuál de los dos caminos va este cliente
 *
 * El `token` de siempre se deja vacío a propósito: en este flujo no hay
 * token de Instagram, y dejar ahí algo parecido invitaría a usarlo
 * contra el host equivocado.
 */
export async function guardarTokenDeFacebook(
    clave: string,
    datos: { tokenPagina: string; paginaId: string; cuentaIg: string },
    env: Env,
): Promise<void> {
    await env.CONTROL.prepare(
        `UPDATE clientes
            SET token_pagina   = ?2,
                pagina_fb      = ?3,
                cuenta_ig      = ?4,
                flujo          = 'facebook',
                token_renovado = datetime('now'),
                actualizado    = datetime('now')
          WHERE clave = ?1`,
    )
        .bind(clave, datos.tokenPagina, datos.paginaId, datos.cuentaIg)
        .run()
}

// ─────────────────────────────────────────────────────────────────────
//  La puerta de servicio: quién tiene llave y quién miró qué
// ─────────────────────────────────────────────────────────────────────
//
// Las dos tablas de aquí abajo existen por una pregunta que un cliente
// puede hacer en serio: **«¿quién ha entrado en mis conversaciones?»**
//
// Hasta el 24/09/2026 la respuesta era «alguien con la llave», porque
// había una sola llave, `ADMIN_TOKEN`, compartida y guardada en la
// configuración del Worker. Con un cliente eso da igual. Con cien no es
// una respuesta, y además no hay forma de quitarle la llave a nadie sin
// quitársela a todos.
//
// Así que la llave pasa a ser de cada persona y cada uso deja una fila.
// Lo que eso hace posible, y antes no, es contestar con nombre y fecha.

/** Una llave ya comprobada. Lo único que importa de ella es de quién es. */
export type Llave = { nombre: string }

/**
 * ¿De quién es esta llave?
 *
 * Recibe el **hash** y no la llave: quien llama ya la ha convertido, y
 * así la llave en claro no llega ni a esta función ni a la base. De la
 * tabla `llaves` no se puede sacar nada con lo que entrar.
 *
 * Devuelve `null` también para las revocadas, que es lo que hace que
 * revocar no necesite un despliegue: se pone `activa = 0` y esa persona
 * deja de entrar en la siguiente petición.
 */
export async function llaveDeLaPuerta(hash: string, env: Env): Promise<Llave | null> {
    try {
        const fila = await env.CONTROL.prepare(
            `SELECT nombre FROM llaves WHERE hash = ?1 AND activa = 1`,
        )
            .bind(hash)
            .first<{ nombre: string }>()
        if (!fila) return null

        // El último uso se actualiza sin esperar el resultado a proposito:
        // que falle no puede impedir entrar, y es sólo informativo.
        env.CONTROL.prepare(`UPDATE llaves SET ultimo_uso = datetime('now') WHERE nombre = ?1`)
            .bind(fila.nombre)
            .run()
            .catch((err) => console.error(`[control] no se pudo marcar el uso de la llave: ${err}`))

        return { nombre: fila.nombre }
    } catch (err) {
        // Si la tabla no se puede leer, no se deja entrar. Es la
        // dirección segura: una herramienta que no entra es una
        // molestia; una puerta que se abre porque falló la comprobación
        // es lo contrario de lo que esta tabla existe para conseguir.
        console.error(`[control] no se pudo comprobar la llave: ${err}`)
        return null
    }
}

/** Una línea del registro de accesos, tal como se guarda y se lee. */
export type Mirada = {
    id?: number
    llave: string
    cliente: string | null
    accion: string
    detalle: string | null
    resultado: string | null
    cuando?: string
}

/**
 * Deja constancia de una entrada por la puerta de servicio.
 *
 * ── Por qué no puede fallar hacia arriba ───────────────────────────
 *
 * Porque se llama después de hacer el trabajo, y hacer caer una consulta
 * que ya salió bien porque no se pudo apuntar sería cambiar un problema
 * de registro por un problema de servicio. Se apunta el fallo en el log
 * del Worker y se sigue.
 *
 * Eso tiene una consecuencia honesta que conviene no maquillar: **el
 * registro puede tener huecos** si D1 falla. No es un libro contable.
 * Sirve para contestar quién miró, no para demostrar que nadie miró.
 */
export async function apuntarMirada(m: Mirada, env: Env): Promise<void> {
    try {
        await env.CONTROL.prepare(
            `INSERT INTO registro_admin (llave, cliente, accion, detalle, resultado)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
            // El detalle se recorta aquí y no en quien llama, para que no
            // haya un sitio por donde entre una consulta de un megabyte.
            .bind(m.llave, m.cliente, m.accion, m.detalle?.slice(0, 500) ?? null, m.resultado)
            .run()
    } catch (err) {
        console.error(`[control] no se pudo apuntar el acceso de «${m.llave}»: ${err}`)
    }
}

/**
 * Quién miró los datos de un cliente, lo último primero.
 *
 * Sin `cliente` devuelve todo, que es la vista de mantenimiento. Con
 * `cliente` devuelve lo que se le contestaría a **ese** negocio si
 * preguntara, y es la consulta para la que están los índices.
 */
export async function quienMiro(
    cliente: string | null,
    limite: number,
    env: Env,
): Promise<Mirada[]> {
    const tope = Math.min(Math.max(limite, 1), 500)
    try {
        const { results } = cliente
            ? await env.CONTROL.prepare(
                  `SELECT id, llave, cliente, accion, detalle, resultado, cuando
                     FROM registro_admin WHERE cliente = ?1 ORDER BY id DESC LIMIT ?2`,
              )
                  .bind(cliente, tope)
                  .all<Mirada>()
            : await env.CONTROL.prepare(
                  `SELECT id, llave, cliente, accion, detalle, resultado, cuando
                     FROM registro_admin ORDER BY id DESC LIMIT ?1`,
              )
                  .bind(tope)
                  .all<Mirada>()
        return results ?? []
    } catch (err) {
        console.error(`[control] no se pudo leer el registro de accesos: ${err}`)
        return []
    }
}
