/**
 * La bateria de pruebas contra un Worker local.
 *
 * -- Que comprueba -------------------------------------------------
 *
 * Los caminos que importan, y sobre todo los que no se pueden probar con
 * una cuenta de verdad: que un comentario duplicado se corta, que una
 * cuenta desconocida no rompe nada, y que una firma mala se rechaza.
 *
 * -- Lo que da por bueno un fallo de envio --------------------------
 *
 * El cliente de prueba tiene un token inventado, asi que **todo envio
 * falla**, y eso es exactamente lo que se quiere: demuestra que la
 * decision llego hasta el final y que el error se guarda donde toca. Si
 * algun dia estas pruebas pasaran sin ningun fallo de envio, seria mala
 * senal: significaria que se esta mandando a Meta de verdad.
 *
 * Antes de correrlo:
 *   npm run dev          (en otra terminal)
 *   node herramientas/preparar-pruebas.mjs
 *
 * Y despues:
 *   node herramientas/probar.mjs
 */

import { createHash, createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SIMULAR = join(AQUI, 'simular.mjs')

/**
 * El segundo secreto, el de la app de Instagram.
 *
 * Meta puede mandar los eventos de una misma cuenta firmados con
 * cualquiera de las dos apps que apuntan al webhook, asi que hay que
 * comprobar que las dos entran. Validar contra una sola tira la mitad de
 * lo que llega y el registro dice «la firma no valida», que parece un
 * ataque y en realidad es un secreto que falta.
 */
function secretoDeInstagram() {
    try {
        const texto = readFileSync(join(AQUI, '..', '.dev.vars'), 'utf8')
        for (const linea of texto.split(/\r?\n/)) {
            const t = linea.trim()
            const etiqueta = 'META_APP_SECRET_INSTAGRAM='
            if (t.startsWith(etiqueta)) return t.slice(etiqueta.length)
        }
    } catch {}
    return null
}

const SECRETO_INSTAGRAM = secretoDeInstagram()

/** La cuenta del cliente de prueba, la misma que en `preparar-pruebas.mjs`. */
const CUENTA = '17841400000000000'

/** Y la del cliente que va por el flujo de Facebook. */
const CUENTA_FB = '17841400000000002'

function simular(args) {
    try {
        return execFileSync('node', [SIMULAR, ...args, '--callado'], { encoding: 'utf8' })
    } catch (err) {
        return String(err.stdout ?? '') + String(err.stderr ?? '')
    }
}

/** Lee «aceptados: N  rechazados: M» del resumen. */
function contar(salida) {
    const m = salida.match(/aceptados:\s*(\d+)\s+rechazados:\s*(\d+)/)
    return m ? { ok: Number(m[1]), no: Number(m[2]) } : { ok: -1, no: -1 }
}

const casos = [
    {
        que: 'una firma correcta se acepta',
        args: ['comentario', '--cuenta', CUENTA, '--texto', 'info'],
        espera: (r) => r.ok === 1 && r.no === 0,
    },
    {
        que: 'una firma mala se rechaza',
        args: ['comentario', '--cuenta', CUENTA, '--firma-mala'],
        espera: (r) => r.ok === 0 && r.no === 1,
    },
    {
        que: 'sin firma se rechaza',
        args: ['comentario', '--cuenta', CUENTA, '--sin-firma'],
        espera: (r) => r.ok === 0 && r.no === 1,
    },
    {
        // Los tres se aceptan con 200, y tiene que ser asi: Meta no debe
        // reintentar. Lo que hay que mirar para saber si el duplicado se
        // corto es el registro del Worker, no el codigo de respuesta.
        que: 'el mismo comentario tres veces se acepta tres veces (el corte es interno)',
        args: ['comentario', '--cuenta', CUENTA, '--texto', 'info', '--comentario', `c_${Date.now()}`, '--repetir', '3'],
        espera: (r) => r.ok === 3 && r.no === 0,
    },
    {
        // El caso que costo horas en el bot de una sola cuenta: la mitad de los
        // eventos venian firmados por la otra app y se caian todos.
        que: 'una firma de la app de Instagram tambien se acepta',
        args: ['comentario', '--cuenta', CUENTA, '--texto', 'info', '--secreto', SECRETO_INSTAGRAM ?? 'no-hay'],
        espera: (r) => r.ok === 1 && r.no === 0,
        salta: !SECRETO_INSTAGRAM && 'no hay META_APP_SECRET_INSTAGRAM en .dev.vars',
    },
    {
        que: 'una cuenta desconocida no rompe nada',
        args: ['comentario', '--cuenta', '999999999', '--texto', 'info'],
        espera: (r) => r.ok === 1,
    },
    {
        que: 'un mensaje directo se acepta',
        args: ['mensaje', '--cuenta', CUENTA, '--texto', 'hola'],
        espera: (r) => r.ok === 1,
    },
    {
        que: 'una respuesta a una historia se acepta',
        args: ['historia', '--cuenta', CUENTA, '--texto', 'si'],
        espera: (r) => r.ok === 1,
    },
    {
        que: 'un eco de la propia cuenta se acepta y se ignora',
        args: ['eco', '--cuenta', CUENTA],
        espera: (r) => r.ok === 1,
    },
    {
        que: 'un comentario de la propia cuenta se acepta y se ignora',
        args: ['propio', '--cuenta', CUENTA],
        espera: (r) => r.ok === 1,
    },
]

let bien = 0
let mal = 0

let saltados = 0

for (const caso of casos) {
    if (caso.salta) {
        saltados++
        console.log(`  --   ${caso.que}   (saltada: ${caso.salta})`)
        continue
    }
    const r = contar(simular(caso.args))
    const paso = caso.espera(r)
    if (paso) bien++
    else mal++
    console.log(`  ${paso ? 'OK  ' : 'MAL '} ${caso.que}   (aceptados ${r.ok}, rechazados ${r.no})`)
}

// ---- las rutas de conexion de una cuenta ---------------------------
//
// Estas no pasan por el simulador: son GET normales. Lo que se prueba
// es lo que se puede probar sin Instagram, que es la mitad que nos toca:
// que la ida arme bien la URL de autorizacion, y sobre todo que la
// vuelta **rechace un state que no firmamos nosotros**. Sin eso,
// cualquiera podria colgarle su cuenta de Instagram a un cliente ajeno.

/*
 * A que Worker se le habla.
 *
 * Se puede cambiar con `WORKER=http://127.0.0.1:8788 npm run probar`, y
 * hace falta de verdad: si quedo vivo un `wrangler dev` de antes
 * ocupando el 8787, el nuevo arranca en el 8788 y **la bateria pasa
 * entera contra el codigo viejo**. Veintidos OK sobre un Worker que no
 * tiene los cambios es peor que veintidos fallos, porque uno se los
 * cree. Paso el 24/09/2026.
 *
 * El puerto de verdad lo dice la ultima linea de `npm run dev`:
 * «Ready on http://127.0.0.1:PUERTO».
 */
const RAIZ_WORKER = process.env.WORKER ?? 'http://127.0.0.1:8787'

async function mirar(que, ruta, comprueba) {
    let res
    try {
        res = await fetch(RAIZ_WORKER + ruta, { redirect: 'manual' })
    } catch (err) {
        console.log(`  MAL  ${que}   (no se pudo conectar: ${err.message})`)
        mal++
        return
    }
    const detalle = await comprueba(res)
    if (detalle === true) {
        console.log(`  OK   ${que}   (HTTP ${res.status})`)
        bien++
    } else {
        console.log(`  MAL  ${que}   (HTTP ${res.status}: ${detalle})`)
        mal++
    }
}

console.log('')

await mirar('conectar manda a Instagram con un state firmado', '/conectar/prueba', (res) => {
    if (res.status !== 302) return 'no redirige'
    const destino = res.headers.get('location') ?? ''
    if (!destino.startsWith('https://www.instagram.com/oauth/authorize')) return destino
    const p = new URL(destino).searchParams
    if (!p.get('client_id')) return 'sin client_id'
    if (!p.get('state')?.startsWith('prueba.')) return 'el state no lleva la clave'
    if (p.get('state').length < 20) return 'el state no parece firmado'
    if (!p.get('scope')?.includes('manage_messages')) return 'faltan permisos'
    return true
})

/*
 * Un cliente con Pagina va por la otra app, y por el MISMO enlace.
 *
 * Hay dos apps de Meta y el cliente no tiene por que saberlo: pincha
 * `/conectar/<clave>` y el Worker decide. Si esto se rompiera, el
 * sintoma seria que a los clientes con Pagina les sale la pantalla de
 * Instagram, autorizan, y el token que vuelve no resuelve su cuenta:
 * o sea, autorizan para nada y encima parece que funciono.
 */
await mirar(
    'un cliente con Pagina se desvia solo al camino de Facebook',
    '/conectar/pruebafb',
    (res) => {
        if (res.status !== 302) return `no redirige (HTTP ${res.status})`
        const destino = res.headers.get('location') ?? ''
        if (!destino.endsWith('/conectar-facebook/pruebafb')) return destino
        return true
    },
)

await mirar('una clave que no existe no conecta', '/conectar/no-existe-este', (res) =>
    res.status === 404 ? true : 'deberia ser 404',
)

await mirar(
    'la vuelta rechaza un state que no firmamos',
    '/oauth/instagram?code=falso&state=prueba.0000000000000000000000000000000000000000000000000000000000000000',
    (res) => (res.status === 403 ? true : 'deberia ser 403'),
)

await mirar(
    'la vuelta rechaza un state sin firma',
    '/oauth/instagram?code=falso&state=prueba',
    (res) => (res.status === 403 ? true : 'deberia ser 403'),
)

// ---- el tope de envios por hora ------------------------------------
//
// Meta permite 750 llamadas por hora y por cuenta, y un reel que se
// vuelve viral lo agota en minutos. Lo que se prueba aqui es que al
// llegar al tope la respuesta **no se pierde**: se aparta para la hora
// siguiente, que es lo que la salva, porque una respuesta privada tiene
// 7 dias de plazo.
//
// Se toca la base a mano para no tener que mandar 700 comentarios.

/**
 * La llave de la puerta de servicio en local.
 *
 * Sale de `.dev.vars`, que es lo que lee `wrangler dev`. No es la de
 * produccion a proposito: la bateria no debe poder tocar nada de verdad
 * ni por accidente.
 */
function llaveLocal() {
    try {
        const texto = readFileSync(join(AQUI, '..', '.dev.vars'), 'utf8')
        for (const l of texto.split(/\r?\n/)) {
            const t = l.trim()
            if (t.startsWith('ADMIN_TOKEN=')) return t.slice('ADMIN_TOKEN='.length)
        }
    } catch {}
    return null
}
const LLAVE = llaveLocal()

/**
 * Mira dentro del objeto del cliente de prueba.
 *
 * Antes esto era `wrangler d1 execute chatychat-prueba`. Ya no hay base
 * D1 que mirar: los datos viven en el Durable Object, y la unica forma
 * de verlos desde fuera es la puerta de servicio.
 */
async function leerDePrueba(sql, cliente = 'prueba') {
    const r = await fetch(`${RAIZ_WORKER}/admin/consultar?cliente=${cliente}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${LLAVE}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sql }),
    })
    const d = await r.json()
    if (d.error) throw new Error(d.error)
    return d.filas ?? []
}

/**
 * Deja el cliente de prueba en su estado de partida.
 *
 * ── Por que se siembra entero en vez de borrar trozos ──────────────
 *
 * Antes cada prueba hacia su propio `DELETE FROM lo-que-le-estorbaba`.
 * Eso funciona hasta que una prueba nueva depende de algo que otra
 * borro, y entonces falla **la que no tiene la culpa**. Sembrar de cero
 * hace que cada prueba empiece desde el mismo sitio y que el orden entre
 * ellas deje de importar.
 *
 * `llamadas` es el contador de envios de esta hora: ponerlo a 699 deja
 * al cliente a una llamada del tope, que es como se prueba que lo que no
 * cabe se aparta en vez de perderse.
 */
async function sembrarPrueba({ llamadas = 0, cliente = 'prueba' } = {}) {
    const hora = new Date().toISOString().slice(0, 13).replace('T', ' ')
    const datos = {
        automatizaciones: [
            {
                id: 1,
                nombre: '1. Prueba',
                activa: 1,
                archivada: 0,
                respuesta: 'Hola! Te paso la info que pediste.',
                aviso_publico: 'Listoo, mira tus DMs',
            },
        ],
        disparadores: [
            { automatizacion_id: 1, tipo: 'comentario', objetivo: null, palabras: 'info|precio', activo: 1 },
            // El mismo por mensaje directo, que es el que puede arrancar
            // un flujo con botones: un comentario no abre la ventana de
            // 24 horas y un mensaje si.
            { automatizacion_id: 1, tipo: 'mensaje', objetivo: null, palabras: 'info|precio', activo: 1 },
        ],
        nodos: [
            { automatizacion_id: 1, tipo: 'mensaje', texto: 'Hola! Te paso la info que pediste.', orden: 0 },
        ],
        ritmo: llamadas ? [{ hora, llamadas }] : [],
    }

    const r = await fetch(`${RAIZ_WORKER}/admin/sembrar?cliente=${cliente}&vaciar=si`, {
        method: 'POST',
        headers: { authorization: `Bearer ${LLAVE}`, 'content-type': 'application/json' },
        body: JSON.stringify(datos),
    })
    const d = await r.json()
    if (d.error) throw new Error(d.error)
}

function esperar(ms) {
    return new Promise((r) => setTimeout(r, ms))
}

// ---- el tope de envios por hora ------------------------------------

try {
    // Se deja al cliente a una llamada del tope. Se toca el contador en
    // vez de mandar 700 comentarios, que seria lo mismo pero tardando.
    await sembrarPrueba({ llamadas: 699 })

    simular(['comentario', '--cuenta', CUENTA, '--texto', 'info'])
    // El Worker contesta el webhook enseguida y hace el trabajo despues,
    // asi que hay que darle un momento antes de mirar.
    await esperar(2500)

    const filas = await leerDePrueba('SELECT tipo, estado FROM pendientes')

    const apartada = filas.some((f) => f.tipo === 'comentario' && f.estado === 'espera')
    if (apartada) {
        console.log('  OK   al llegar al tope por hora, la respuesta se aparta y no se pierde')
        bien++
    } else {
        console.log(
            `  MAL  al llegar al tope por hora, la respuesta se aparta   (quedo: ${JSON.stringify(filas)})`,
        )
        mal++
    }
} catch (err) {
    console.log(`  MAL  el tope por hora   (no se pudo probar: ${err.message})`)
    mal++
}

// ---- los flujos con botones ----------------------------------------
//
// Lo que se comprueba es la parte que no depende de Meta: que un clic se
// atienda en vez de ignorarse, y que **se guarde como mensaje**, que es
// lo que abre la ventana de 24 horas. Si no se guardara, el propio bot
// creeria que esa persona no ha escrito nunca y no le podria contestar.
//
// El envio falla por el token inventado, como todo lo demas.

try {
    await sembrarPrueba()
    simular(['boton', '--cuenta', CUENTA])
    await esperar(2500)

    const filas = await leerDePrueba('SELECT tipo, texto FROM eventos ORDER BY id DESC LIMIT 1')

    const guardado = filas[0]
    if (guardado?.tipo === 'mensaje' && String(guardado.texto).startsWith('[boton]')) {
        console.log('  OK   un clic en un boton se atiende y abre la ventana de 24 h')
        bien++
    } else {
        console.log(`  MAL  un clic en un boton se atiende   (quedo: ${JSON.stringify(filas)})`)
        mal++
    }
} catch (err) {
    console.log(`  MAL  el clic en un boton   (no se pudo probar: ${err.message})`)
    mal++
}

// ---- el cliente que va por Facebook --------------------------------
//
// El segundo de los dos flujos de Meta, y el que no tiene ninguna cuenta
// real con la que probarse todavia.
//
// Lo que se comprueba es que un comentario suyo **llega hasta el
// envio**. Importa porque su columna `token` esta VACIA —el suyo es el
// de la Pagina, en `token_pagina`— y cualquier comprobacion que mire
// `token` para decidir si se le puede contestar lo dejaria fuera en
// silencio, que es indistinguible de que nadie haya comentado.
//
// A que host salio no se puede ver desde aqui: Meta contesta
// exactamente el mismo «Invalid OAuth access token» desde los dos,
// comprobado el 24/09/2026. Eso se mira en el registro del Worker, que
// dice «fallo por facebook» o «fallo por instagram» en cada envio.

try {
    await sembrarPrueba({ cliente: 'pruebafb' })
    const comentario = `c_fb_${Date.now()}`
    simular(['comentario', '--cuenta', CUENTA_FB, '--texto', 'info', '--comentario', comentario])
    await esperar(2500)

    const filas = await leerDePrueba(
        'SELECT comentario_id, respondido, error FROM eventos ORDER BY id DESC LIMIT 1',
        'pruebafb',
    )

    const guardado = filas[0]
    // `error` con algo dentro es lo correcto: el token de la Pagina es
    // inventado. Lo que se prueba es que se intento, no que Meta acepto.
    if (guardado?.comentario_id === comentario && guardado?.error) {
        console.log('  OK   a un cliente con Pagina de Facebook se le intenta contestar')
        bien++
    } else {
        console.log(
            `  MAL  a un cliente con Pagina de Facebook se le intenta contestar   (quedo: ${JSON.stringify(filas)})`,
        )
        mal++
    }
} catch (err) {
    console.log(`  MAL  el cliente por Facebook   (no se pudo probar: ${err.message})`)
    mal++
}

// ---- las rutas de privacidad ---------------------------------------
//
// Lo que Meta llama cuando un negocio nos desconecta o cuando alguien
// pide que le borren sus datos. Las dos llegan con un «sobre firmado»
// que hay que comprobar antes de creerse nada: **son direcciones
// publicas**, y sin comprobar la firma cualquiera que supiera la URL
// podria desconectarnos a un cliente o pedir un borrado en su nombre.

function secretoDeDesarrollo() {
    try {
        const texto = readFileSync(join(AQUI, '..', '.dev.vars'), 'utf8')
        for (const linea of texto.split(/\r?\n/)) {
            const t = linea.trim()
            if (t.startsWith('META_APP_SECRET=')) return t.slice('META_APP_SECRET='.length)
        }
    } catch {}
    return null
}

const SECRETO_DEV = secretoDeDesarrollo()

/** El formato de Meta: firma y contenido, separados por un punto. */
function sobre(datos, secreto) {
    const carga = Buffer.from(JSON.stringify(datos)).toString('base64url')
    return createHmac('sha256', secreto).update(carga).digest('base64url') + '.' + carga
}

async function postear(que, ruta, firmado, comprueba) {
    let res
    try {
        res = await fetch(RAIZ_WORKER + ruta, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ signed_request: firmado }),
        })
    } catch (err) {
        console.log(`  MAL  ${que}   (no se pudo conectar: ${err.message})`)
        mal++
        return
    }
    const detalle = await comprueba(res)
    if (detalle === true) {
        console.log(`  OK   ${que}   (HTTP ${res.status})`)
        bien++
    } else {
        console.log(`  MAL  ${que}   (HTTP ${res.status}: ${detalle})`)
        mal++
    }
}

if (!SECRETO_DEV) {
    console.log('  --   las rutas de privacidad   (saltadas: no hay META_APP_SECRET en .dev.vars)')
    saltados++
} else {
    const bueno = sobre({ algorithm: 'HMAC-SHA256', user_id: CUENTA }, SECRETO_DEV)
    const malo = sobre({ algorithm: 'HMAC-SHA256', user_id: CUENTA }, 'un-secreto-que-no-es')

    console.log('')

    await postear('la desconexion con firma buena se acepta', '/oauth/cancelada', bueno, (res) =>
        res.status === 200 ? true : 'deberia ser 200',
    )
    await postear('la desconexion con firma mala se rechaza', '/oauth/cancelada', malo, (res) =>
        res.status === 403 ? true : 'deberia ser 403',
    )

    await postear('el borrado devuelve el codigo que Meta espera', '/datos/eliminar', bueno, async (res) => {
        if (res.status !== 200) return 'deberia ser 200'
        let datos
        try {
            datos = await res.json()
        } catch {
            return 'no devolvio JSON'
        }
        // Estos dos nombres los exige Meta tal cual.
        if (!datos.confirmation_code) return 'sin confirmation_code'
        if (!datos.url?.includes(datos.confirmation_code)) return 'la url no lleva el codigo'
        return true
    })
    await postear('el borrado con firma mala se rechaza', '/datos/eliminar', malo, (res) =>
        res.status === 403 ? true : 'deberia ser 403',
    )

    await mirar('un codigo de seguimiento inventado no existe', '/datos/estado?c=noexiste', (res) =>
        res.status === 404 ? true : 'deberia ser 404',
    )
    await mirar('la vuelta de OAuth abierta a mano se explica', '/oauth/instagram', async (res) => {
        const texto = await res.text()
        return texto.includes('no se abre a mano') ? true : texto.slice(0, 40)
    })
}

// ─────────────────────────────────────────────────────────────────────
//  La puerta de servicio: quien entra, quien no, y que queda apuntado
// ─────────────────────────────────────────────────────────────────────
//
// Esto se prueba aqui y no a mano por un motivo concreto: **una puerta
// que deja de cerrarse no da ningun error**. Sigue contestando 200 a
// quien tiene que entrar, y el dia que alguien revoca una llave de
// verdad porque hay que cortarle el acceso a alguien, se descubre que no
// servia. Lo mismo con el registro: si deja de apuntar, lo unico que
// pasa es que la respuesta a «quien miro mis datos» se queda vacia, y
// una lista vacia se lee como «nadie».
//
// Las cuatro primeras no tocan nada. La de revocar si: crea una llave
// llamada `bateria` en la base LOCAL, la usa, la revoca y la borra. Por
// eso va con `--local` por delante en todas las llamadas a wrangler.

/** Llama a la puerta con la llave que se le diga, o sin ninguna. */
async function puerta(que, ruta, llave, esperado, metodo = 'GET') {
    const cabeceras = llave ? { authorization: `Bearer ${llave}` } : {}
    let res
    try {
        res = await fetch(RAIZ_WORKER + ruta, { method: metodo, headers: cabeceras })
    } catch (err) {
        console.log(`  MAL  ${que}   (no se pudo conectar: ${err.message})`)
        mal++
        return null
    }
    if (res.status === esperado) {
        console.log(`  OK   ${que}   (HTTP ${res.status})`)
        bien++
    } else {
        console.log(`  MAL  ${que}   (HTTP ${res.status}, deberia ser ${esperado})`)
        mal++
    }
    return res
}

console.log('')

if (!LLAVE) {
    console.log('  --   la puerta de servicio   (saltada: no hay ADMIN_TOKEN en .dev.vars)')
    saltados++
} else {
    await puerta('sin llave, la puerta no existe', '/admin/estado?cliente=prueba', null, 404)
    await puerta(
        'con una llave inventada, tampoco',
        '/admin/estado?cliente=prueba',
        'esta-llave-no-la-dimos-nunca',
        404,
    )
    await puerta('con la llave buena, se entra', '/admin/estado?cliente=prueba', LLAVE, 200)

    // Que el registro apunte es la mitad de lo que hace falta; la otra es
    // que apunte **el intento rechazado**, que es lo unico que distingue a
    // alguien probando llaves de que no haya pasado nada.
    const res = await puerta('el registro devuelve lo que se apunto', '/admin/registro?limite=20', LLAVE, 200)
    if (res) {
        const { filas } = await res.json().catch(() => ({ filas: [] }))
        const hayRechazada = filas?.some((f) => String(f.llave).startsWith('desconocida:'))
        const hayEntrada = filas?.some((f) => f.accion === 'estado' && f.resultado === 'bien')
        if (hayRechazada && hayEntrada) {
            console.log('  OK   el registro guarda tanto la entrada como el intento rechazado')
            bien++
        } else {
            console.log(
                `  MAL  el registro guarda tanto la entrada como el intento rechazado   ` +
                    `(entrada: ${hayEntrada ? 'si' : 'NO'}, rechazada: ${hayRechazada ? 'si' : 'NO'})`,
            )
            mal++
        }
    }

    // ---- que revocar sirve de verdad --------------------------------

    const d1 = (sql) =>
        execFileSync(
            'npx',
            [
                'wrangler', 'd1', 'execute', 'chatychat-control',
                '--env', 'desarrollo', '--local', '--command', `"${sql.replace(/\s+/g, ' ').trim()}"`,
            ],
            { cwd: join(AQUI, '..'), encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
        )

    try {
        // Una llave de un solo uso, distinta en cada pasada: si una pasada
        // anterior se corto por la mitad, su fila no estorba a esta.
        const suya = `bateria-${Date.now().toString(36)}`
        const huella = createHash('sha256').update(suya, 'utf8').digest('hex')
        d1(`DELETE FROM llaves WHERE nombre = 'bateria'`)
        d1(`INSERT INTO llaves (nombre, hash, nota) VALUES ('bateria', '${huella}', 'la crea y la borra probar.mjs')`)

        await puerta('una llave propia entra', '/admin/estado?cliente=prueba', suya, 200)

        d1(`UPDATE llaves SET activa = 0, revocada = datetime('now') WHERE nombre = 'bateria'`)

        // Sin desplegar nada entre las dos llamadas: eso es lo que se esta
        // comprobando. Una llave que solo dejara de valer al redesplegar
        // no serviria el dia que hay que cortar un acceso ya.
        await puerta('revocada, deja de entrar sin desplegar', '/admin/estado?cliente=prueba', suya, 404)

        d1(`DELETE FROM llaves WHERE nombre = 'bateria'`)
    } catch (err) {
        console.log(`  --   revocar una llave   (saltada: ${String(err.message).slice(0, 60)})`)
        saltados++
    }
}

console.log(`\n${bien} bien, ${mal} mal${saltados ? `, ${saltados} saltadas` : ''}`)
console.log(
    '\nMirá tambien el registro del Worker: ahi se ve si el duplicado se corto' +
        '\n(«ya estaba atendido»), a que cliente se enruto cada evento, y que los' +
        '\nenvios fallan por el token inventado, que es lo correcto.',
)
process.exit(mal === 0 ? 0 : 1)
