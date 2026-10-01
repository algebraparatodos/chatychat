/**
 * Pone al día la base de control cuando el esquema crece.
 *
 *   node herramientas/migrar-control.mjs            (la de verdad)
 *   node herramientas/migrar-control.mjs --local    (la de pruebas)
 *
 * ── Por qué hace falta, si ya está `control.sql` ───────────────────
 *
 * Porque el esquema está escrito con `CREATE TABLE IF NOT EXISTS`, que
 * es lo correcto para crear una base nueva y **no hace nada** sobre una
 * que ya existe. Una columna añadida después no aparece por volver a
 * aplicarlo, y el síntoma es feo: el Worker consulta una columna que no
 * está y falla en ejecución, con un error de SQL que no dice que falte
 * una migración.
 *
 * Cada paso se intenta y, si la columna ya estaba, se da por bueno. Así
 * se puede correr las veces que haga falta y contra una base en
 * cualquier estado, que es lo único que sirve cuando no se sabe con
 * certeza cuál se aplicó.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entornoCloudflare } from './claves.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEMP = mkdtempSync(join(tmpdir(), 'chatychat-migrar-'))
const LOCAL = process.argv.includes('--local')

/**
 * Los cambios, en orden y sin quitar ninguno nunca.
 *
 * Esta lista es la historia del esquema: cada base que exista en algún
 * sitio está en algún punto de ella. Borrar una línea que parece vieja
 * rompe justamente la base que se quedó atrás, que es la que más
 * necesita la migración.
 */
const PASOS = [
    ['token_renovado', `ALTER TABLE clientes ADD COLUMN token_renovado TEXT`],
    ['salud', `ALTER TABLE clientes ADD COLUMN salud TEXT NOT NULL DEFAULT 'sin revisar'`],
    ['salud_desde', `ALTER TABLE clientes ADD COLUMN salud_desde TEXT`],
    ['plataforma', `CREATE TABLE IF NOT EXISTS plataforma (clave TEXT PRIMARY KEY, valor TEXT)`],
    // Quien puede entrar al panel.
    //
    // El usuario no es la clave del cliente: «acme-shop» entra al cliente
    // «acmeshop», y un dia un cliente puede tener dos personas entrando.
    //
    // La contrasena NO se guarda: se guarda de que deriva. PBKDF2 con
    // SHA-256, que es lo que hay en un Worker (`crypto.subtle` no trae
    // bcrypt ni argon2), con sal propia por usuario para que dos
    // contrasenas iguales no den el mismo resto.
    //
    // Las vueltas van en una columna y no fijas en el codigo, para poder
    // subirlas cuando las maquinas sean mas rapidas sin invalidar los
    // hashes viejos: cada uno se comprueba con las suyas.
    //
    // ⚠️ El SQL va **sin comentarios `--` dentro**, y es a proposito:
    // estos pasos se mandan en una sola linea, y ahi un `--` se come
    // todo lo que venga detras. Costo una migracion entera el 22/09.
    [
        'accesos',
        `CREATE TABLE IF NOT EXISTS accesos (
            usuario TEXT PRIMARY KEY,
            cliente TEXT NOT NULL REFERENCES clientes(clave),
            hash    TEXT NOT NULL,
            sal     TEXT NOT NULL,
            vueltas INTEGER NOT NULL,
            creado  TEXT NOT NULL DEFAULT (datetime('now')),
            ultimo  TEXT
        )`,
    ],
    // Por cual de los dos flujos de Meta va cada cliente.
    //
    // 'instagram' : Instagram Login. La cuenta esta solo en Instagram.
    // 'facebook'  : Facebook Login. La cuenta esta enlazada a una Pagina.
    // NULL        : todavia no conecto, no se sabe.
    //
    // No es una preferencia nuestra ni del cliente: lo decide como tenga
    // montada su cuenta, y Meta no deja las dos configuraciones en la
    // misma app. De ahi que haya dos apps y que cada cliente tenga que
    // recordar a cual pertenece: el token, el host de la API y hasta la
    // forma de identificarle en un webhook cambian segun cual sea.
    ['flujo', `ALTER TABLE clientes ADD COLUMN flujo TEXT`],

    // La Pagina de Facebook, cuando el cliente va por ese flujo.
    //
    // Con Facebook Login no se habla con la cuenta de Instagram: se
    // habla con la Pagina que la tiene enlazada, y el token es de la
    // Pagina. `pagina_fb` ya existia de antes y guardaba el id; esto
    // guarda su token, que es otra cosa y caduca distinto.
    ['token_pagina', `ALTER TABLE clientes ADD COLUMN token_pagina TEXT`],

    [
        'borrados',
        `CREATE TABLE IF NOT EXISTS borrados (
            codigo TEXT PRIMARY KEY,
            quien TEXT NOT NULL,
            cliente TEXT,
            estado TEXT NOT NULL DEFAULT 'recibida',
            recibida TEXT NOT NULL DEFAULT (datetime('now')),
            terminada TEXT,
            nota TEXT
        )`,
    ],

    // Quien puede abrir la puerta de servicio, una llave por persona.
    //
    // Hasta el 24/09/2026 habia UNA sola llave, `ADMIN_TOKEN`, compartida
    // y metida en la configuracion del Worker. Con un cliente daba igual.
    // Con cien es el problema que un cliente pregunta en serio: quien ha
    // entrado en mis datos. Con una llave compartida la respuesta es
    // «alguien con la llave», que no es una respuesta.
    //
    // Estan en la base y no en la configuracion para que **revocar no
    // necesite un despliegue**: se pone `activa = 0` y esa persona deja
    // de entrar en la siguiente peticion. Una llave en una variable de
    // entorno se quita redesplegando, y eso se pospone.
    //
    // Se guarda el hash y nunca la llave. Si alguien lee esta tabla no
    // se lleva nada con lo que entrar.
    [
        'llaves',
        `CREATE TABLE IF NOT EXISTS llaves (
            nombre TEXT PRIMARY KEY,
            hash TEXT NOT NULL,
            activa INTEGER NOT NULL DEFAULT 1,
            creada TEXT NOT NULL DEFAULT (datetime('now')),
            revocada TEXT,
            ultimo_uso TEXT,
            nota TEXT
        )`,
    ],

    // Quien miro que, y cuando.
    //
    // Cada peticion a la puerta de servicio deja una fila. No es por
    // desconfianza: es que **sin registro no hay respuesta posible**
    // cuando un cliente o una autoridad pregunta quien ha leido sus
    // conversaciones, y esa pregunta llega tarde, cuando ya no se puede
    // reconstruir.
    //
    // Vive en la base de control y no en la del cliente a proposito: un
    // registro de accesos que se borra al borrar los datos del cliente
    // no sirve para demostrar nada. Por el mismo motivo que los borrados.
    //
    // `detalle` guarda el SQL o la accion, recortado. Se recorta porque
    // una consulta larga no aporta mas que sus primeros caracteres y
    // porque esta tabla crece con cada peticion.
    [
        'registro_admin',
        `CREATE TABLE IF NOT EXISTS registro_admin (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            llave TEXT NOT NULL,
            cliente TEXT,
            accion TEXT NOT NULL,
            detalle TEXT,
            resultado TEXT,
            cuando TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
    ],
    ['registro_admin_por_cliente', `CREATE INDEX IF NOT EXISTS registro_admin_por_cliente ON registro_admin (cliente, id DESC)`],
    ['registro_admin_por_llave', `CREATE INDEX IF NOT EXISTS registro_admin_por_llave ON registro_admin (llave, id DESC)`],
]

const entorno = LOCAL ? { ...process.env } : entornoCloudflare()

console.log(`\nMigrando la base de control ${LOCAL ? 'LOCAL' : 'de verdad'}\n`)

let hechos = 0
let yaEstaban = 0

for (const [nombre, sql] of PASOS) {
    const ruta = join(TEMP, `${nombre}.sql`)
    writeFileSync(ruta, `${sql};\n`, 'utf8')
    const args = ['wrangler', 'd1', 'execute', 'chatychat-control']
    if (LOCAL) args.push('--env', 'desarrollo', '--local')
    else args.push('--remote', '-y')
    args.push(`--file=${ruta}`)

    try {
        execFileSync('npx', args, {
            cwd: RAIZ,
            env: entorno,
            encoding: 'utf8',
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        console.log(`  hecho     ${nombre}`)
        hechos++
    } catch (err) {
        const salida = String(err.stdout ?? '') + String(err.stderr ?? '')
        // «duplicate column name» es el único error que significa «esto
        // ya estaba»: cualquier otro es un problema de verdad y no se
        // puede tragar, porque dejaría la base a medio migrar sin
        // decirlo.
        if (/duplicate column name/i.test(salida)) {
            console.log(`  ya estaba ${nombre}`)
            yaEstaban++
        } else {
            console.error(`\n  FALLO en «${nombre}»:\n${salida}`)
            process.exit(1)
        }
    }
}

console.log(`\n${hechos} aplicados, ${yaEstaban} que ya estaban.\n`)
