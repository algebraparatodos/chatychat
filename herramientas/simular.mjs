/**
 * Manda al Worker un webhook falso pero bien firmado.
 *
 * -- Por que hace falta --------------------------------------------
 *
 * Sin esto, la unica forma de saber si el bot contesta bien es que
 * llegue un comentario de verdad. Eso es lento, depende de una cuenta
 * ajena y **no se puede repetir**: no se puede volver a mandar el mismo
 * comentario diez veces para comprobar que el duplicado se corta.
 *
 * Con esto se prueban de golpe la firma, el enrutado por cliente, el
 * duplicado, cada tipo de disparador y cada camino de error, contra un
 * Worker local o contra el desplegado.
 *
 * -- Lo que NO simula, y hay que tenerlo presente ------------------
 *
 * Lo que pasa **despues** de decidir: el POST a la API de Meta. Si el
 * bot decide contestar, va a intentarlo de verdad, contra Meta, con el
 * token del cliente. Contra un cliente de prueba con un token inventado
 * eso falla, que es lo que se quiere; contra un cliente real, **sale un
 * mensaje real**.
 *
 * Por eso el guion de abajo se niega a apuntar a produccion salvo que se
 * lo digan dos veces.
 *
 * Uso:
 *   node herramientas/simular.mjs comentario --cuenta 123 --texto "hola"
 *   node herramientas/simular.mjs comentario --repetir 2   (prueba el duplicado)
 *   node herramientas/simular.mjs mensaje --texto "info"
 *   node herramientas/simular.mjs historia --historia 999 --texto "si"
 *   node herramientas/simular.mjs eco
 *
 * Opciones comunes:
 *   --url <url>        a donde mandarlo. Por defecto http://127.0.0.1:8787/webhook
 *   --secreto <s>      con que firmar. Por defecto el de .claves.env
 *   --firma-mala       firma con otro secreto, para probar que se rechaza
 *   --sin-firma        no manda la cabecera
 *   --repetir <n>      manda el MISMO evento n veces, sin cambiar los ids
 *   --callado          solo el resumen
 */

import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))

// ---- los argumentos -------------------------------------------------

const [, , tipo = 'comentario', ...resto] = process.argv
const opciones = {}
for (let i = 0; i < resto.length; i++) {
  if (!resto[i].startsWith('--')) continue
  const clave = resto[i].slice(2)
  const valor = resto[i + 1] && !resto[i + 1].startsWith('--') ? resto[++i] : true
  opciones[clave] = valor
}

const URL_DESTINO =
    opciones.url ?? `${process.env.WORKER ?? 'http://127.0.0.1:8787'}/webhook`
const REPETIR = Number(opciones.repetir ?? 1)
const CALLADO = Boolean(opciones.callado)

/**
 * La red de seguridad.
 *
 * Apuntar el simulador a produccion hace que el bot conteste de verdad a
 * gente de verdad, porque lo unico falso es el aviso de entrada. Se pide
 * confirmacion explicita en vez de confiar en que quien lo escriba se
 * acuerde.
 */
if (!URL_DESTINO.includes('127.0.0.1') && !URL_DESTINO.includes('localhost')) {
  if (!opciones['si-quiero-tocar-produccion']) {
    console.error(
      `Esa URL no es local: ${URL_DESTINO}\n\n` +
        'Si el bot decide contestar, va a mandar un mensaje DE VERDAD a la\n' +
        'persona que figure en el evento. Si es lo que querés, repetilo con\n' +
        '--si-quiero-tocar-produccion',
    )
    process.exit(1)
  }
}

// ---- el secreto -----------------------------------------------------

function secretoDeClaves() {
  // Solo los archivos de ESTE proyecto, y en este orden: `.dev.vars`
  // primero, que es el que usa el Worker en local.
  //
  // Antes esto miraba tambien un `.claves.env` compartido con otros
  // proyectos y aceptaba `IG_APP_SECRET` como alternativa. Eso era un
  // error: esa clave es de otra app y de otra cuenta. Si una se colara,
  // el producto quedaria atado a una cuenta ajena y el sintoma seria una
  // firma que no cuadra sin motivo visible.
  for (const ruta of [join(AQUI, '..', '.dev.vars'), join(AQUI, '..', '.claves.env')]) {
    let texto
    try {
      texto = readFileSync(ruta, 'utf8')
    } catch {
      continue
    }
    for (const linea of texto.split(/\r?\n/)) {
      const t = linea.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const [k, ...v] = t.split('=')
      if (k.trim() === 'META_APP_SECRET') {
        const valor = v.join('=').trim().replace(/^["']|["']$/g, '')
        if (valor) return valor
      }
    }
  }
  return null
}
const SECRETO = opciones.secreto ?? process.env.META_APP_SECRET ?? secretoDeClaves()
if (!SECRETO && !opciones['sin-firma']) {
  console.error(
    'No encuentro con que firmar. Pasá --secreto <valor>, o poné\n' +
      'META_APP_SECRET en el .dev.vars o el .claves.env de este proyecto.',
  )
  process.exit(1)
}

// ---- los eventos ----------------------------------------------------

/**
 * Los ids se generan una vez y se reutilizan en las repeticiones.
 *
 * Eso es justamente lo que prueba el duplicado: Meta manda el mismo
 * comentario con el mismo `id`, y lo que tiene que cortarlo es el indice
 * unico, no que el id sea distinto.
 */
const CUENTA = String(opciones.cuenta ?? '17841400000000000')
const PERSONA = String(opciones.de ?? '900000000000001')
const COMENTARIO = String(opciones.comentario ?? `c_${randomUUID().slice(0, 12)}`)
const MEDIA = String(opciones.media ?? '18000000000000001')
const HISTORIA = String(opciones.historia ?? '18999999999999999')
const TEXTO = String(opciones.texto ?? 'hola, queria info')

const EVENTOS = {
  /** Alguien comenta una publicacion. */
  comentario: () => ({
    object: 'instagram',
    entry: [
      {
        id: CUENTA,
        time: Date.now(),
        changes: [
          {
            field: 'comments',
            value: {
              id: COMENTARIO,
              text: TEXTO,
              from: { id: PERSONA, username: opciones.usuario ?? 'persona_de_prueba' },
              media: { id: MEDIA, media_product_type: 'FEED' },
            },
          },
        ],
      },
    ],
  }),

  /** Un mensaje directo suelto. */
  mensaje: () => ({
    object: 'instagram',
    entry: [
      {
        id: CUENTA,
        time: Date.now(),
        messaging: [
          {
            sender: { id: PERSONA },
            recipient: { id: CUENTA },
            timestamp: Date.now(),
            message: { mid: `m_${randomUUID().slice(0, 12)}`, text: TEXTO },
          },
        ],
      },
    ],
  }),

  /** Alguien responde a una historia. */
  historia: () => ({
    object: 'instagram',
    entry: [
      {
        id: CUENTA,
        time: Date.now(),
        messaging: [
          {
            sender: { id: PERSONA },
            recipient: { id: CUENTA },
            timestamp: Date.now(),
            message: {
              mid: `m_${randomUUID().slice(0, 12)}`,
              text: TEXTO,
              reply_to: { story: { id: HISTORIA, url: 'https://ejemplo/historia' } },
            },
          },
        ],
      },
    ],
  }),

  /** Un eco: lo que manda la propia cuenta. Tiene que ignorarse. */
  eco: () => ({
    object: 'instagram',
    entry: [
      {
        id: CUENTA,
        time: Date.now(),
        messaging: [
          {
            sender: { id: CUENTA },
            recipient: { id: PERSONA },
            timestamp: Date.now(),
            message: { mid: `m_${randomUUID().slice(0, 12)}`, text: TEXTO, is_echo: true },
          },
        ],
      },
    ],
  }),

  /** Un comentario de la propia cuenta: es el aviso publico que pusimos. */
  propio: () => ({
    object: 'instagram',
    entry: [
      {
        id: CUENTA,
        time: Date.now(),
        changes: [
          {
            field: 'comments',
            value: {
              id: COMENTARIO,
              text: 'Listoo, mirá tus DMs',
              from: { id: CUENTA, username: 'la_cuenta' },
              media: { id: MEDIA },
            },
          },
        ],
      },
    ],
  }),

  /** Un clic en un boton. */
  boton: () => ({
    object: 'instagram',
    entry: [
      {
        id: CUENTA,
        time: Date.now(),
        messaging: [
          {
            sender: { id: PERSONA },
            recipient: { id: CUENTA },
            timestamp: Date.now(),
            postback: { mid: `m_${randomUUID().slice(0, 12)}`, title: 'Sii quiero!', payload: 'b1' },
          },
        ],
      },
    ],
  }),
}

const construir = EVENTOS[tipo]
if (!construir) {
  console.error(`No conozco «${tipo}». Los que hay: ${Object.keys(EVENTOS).join(', ')}`)
  process.exit(1)
}

// ---- mandarlo -------------------------------------------------------

/**
 * Se firma **el texto exacto** que se manda, no el objeto.
 *
 * Es la misma trampa que del otro lado: si se firmara el objeto y se
 * serializara aparte, los bytes podrian no coincidir y la firma no
 * cuadraria nunca, sin que nada explique por que.
 */
function firmar(cuerpo, secreto) {
  return 'sha256=' + createHmac('sha256', secreto).update(cuerpo).digest('hex')
}

let ok = 0
let rechazados = 0

for (let i = 1; i <= REPETIR; i++) {
  const cuerpo = JSON.stringify(construir())

  const cabeceras = { 'content-type': 'application/json' }
  if (!opciones['sin-firma']) {
    cabeceras['x-hub-signature-256'] = firmar(
      cuerpo,
      opciones['firma-mala'] ? 'un-secreto-que-no-es' : SECRETO,
    )
  }

  let res
  try {
    res = await fetch(URL_DESTINO, { method: 'POST', headers: cabeceras, body: cuerpo })
  } catch (err) {
    console.error(`  intento ${i}: no se pudo conectar con ${URL_DESTINO}`)
    console.error(`  ${err.message}`)
    console.error('\n  ¿Está corriendo el Worker? Probá con:  npm run dev')
    process.exit(1)
  }

  const texto = (await res.text()).trim()
  if (res.ok) ok++
  else rechazados++

  if (!CALLADO) {
    console.log(`  intento ${i}/${REPETIR}: HTTP ${res.status} ${JSON.stringify(texto)}`)
  }
}

console.log(
  `\n${tipo} -> ${URL_DESTINO}\n` +
    `  aceptados: ${ok}  rechazados: ${rechazados}\n` +
    `  comentario: ${COMENTARIO}  cuenta: ${CUENTA}  persona: ${PERSONA}`,
)
