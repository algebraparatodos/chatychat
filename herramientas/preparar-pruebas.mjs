/**
 * Deja las bases locales listas para la bateria de pruebas.
 *
 * -- Que monta ------------------------------------------------------
 *
 * Una base de control con **un solo cliente**, llamado `prueba`, y su
 * base con el esquema puesto y una automatizacion encendida que se
 * dispara con «info» o «precio».
 *
 * -- El token inventado es a proposito -------------------------------
 *
 * El cliente de prueba lleva `token-falso-no-sirve`, asi que cualquier
 * envio a Meta falla con un 400. Eso es lo que se quiere: el simulador
 * solo falsea la entrada, y a partir de ahi el Worker actua de verdad.
 * Con un token bueno, probar el bot mandaria mensajes a gente real.
 *
 * Se puede correr las veces que haga falta: borra y vuelve a poner los
 * datos de prueba, pero no toca el esquema ni nada remoto.
 *
 *   node herramientas/preparar-pruebas.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..')
const TEMP = mkdtempSync(join(tmpdir(), 'chatychat-'))

/** La cuenta del cliente de prueba. La misma que usa `probar.mjs`. */
const CUENTA = '17841400000000000'

/**
 * Y la del segundo cliente de prueba, el del flujo de Facebook.
 *
 * Hacen falta dos clientes porque el producto tiene **dos caminos
 * distintos hacia Meta** y cual toca lo decide la ficha del cliente. Con
 * uno solo, la mitad del codigo de envio no la recorre ninguna prueba, y
 * el sintoma de que estuviera mal seria que a los clientes con Pagina no
 * les contesta el bot: justo los que no tenemos para probar a mano.
 */
const CUENTA_FB = '17841400000000002'
const PAGINA_FB = '1010101010101010'

/**
 * Corre SQL contra una base local.
 *
 * Siempre con `--env desarrollo`, que es donde viven las bases de
 * prueba, y **siempre `--local`**: sin esas dos, esto correria contra la
 * base de control de produccion.
 *
 * Siempre por archivo y nunca por `--command`: en Windows, el SQL de
 * varias lineas pasado como orden se rompe al pasar por el shell, y el
 * sintoma es un error de sintaxis que no se parece al SQL que uno
 * escribio.
 */
function sql(base, texto, nombre) {
    const ruta = join(TEMP, `${nombre}.sql`)
    writeFileSync(ruta, texto, 'utf8')
    execFileSync(
        'npx',
        ['wrangler', 'd1', 'execute', base, '--env', 'desarrollo', '--local', `--file=${ruta}`],
        { cwd: RAIZ, stdio: 'inherit', shell: true },
    )
}

console.log('\n1/2  el esquema de control')
sql('chatychat-control', readFileSync(join(RAIZ, 'base', 'control.sql'), 'utf8'), 'esquema-control')

console.log('\n2/2  los clientes de prueba')
sql(
    'chatychat-control',
    `DELETE FROM movimientos WHERE cliente IN ('prueba', 'pruebafb');
     DELETE FROM clientes WHERE clave IN ('prueba', 'pruebafb');
     INSERT INTO clientes (clave, nombre, cuenta_ig, token, estado, base_id)
     VALUES ('prueba', 'Cliente de prueba', '${CUENTA}',
             'token-falso-no-sirve', 'alta', 'local-solo-para-pruebas');`,
    'cliente-de-prueba',
)

// La base de control ya puede existir de una pasada anterior, y el
// esquema es todo CREATE TABLE IF NOT EXISTS: no anade columnas nuevas
// a una tabla que ya esta. Por eso se migra tambien.
console.log('')
execFileSync('node', [join(AQUI, 'migrar-control.mjs'), '--local'], {
    cwd: RAIZ,
    stdio: 'inherit',
})

// El segundo cliente va DESPUES de migrar, y no antes: sus columnas
// —`flujo`, `token_pagina`— las anade la migracion, no el esquema base.
// Al reves, el INSERT fallaria con «no such column» en una base que
// viene de una pasada anterior.
console.log('')
sql(
    'chatychat-control',
    `INSERT INTO clientes (clave, nombre, cuenta_ig, token, estado, base_id,
                           flujo, token_pagina, pagina_fb)
     VALUES ('pruebafb', 'Cliente de prueba con Pagina', '${CUENTA_FB}',
             '', 'alta', 'local-solo-para-pruebas',
             'facebook', 'token-de-pagina-falso', '${PAGINA_FB}');`,
    'cliente-de-prueba-facebook',
)

// Los clientes de prueba ya no tienen base que preparar.
//
// Sus datos viven en su Durable Object, y ese objeto **se crea al
// nombrarlo**: la primera vez que el Worker le habla se aplica el
// esquema solo. Aqui no hay nada que hacer.
//
// Los datos de prueba —la automatizacion encendida y sus disparadores—
// los siembra `probar.mjs` por la puerta de servicio, y tiene que ser
// asi: esa puerta vive dentro del Worker, o sea que hace falta que el
// Worker este arrancado, y aqui todavia no lo esta.

console.log(
    '\nListo. Las bases locales viven en .wrangler/, no en Cloudflare.\n' +
        '\nAhora, en otra terminal:  npm run dev' +
        '\nY despues:                node herramientas/probar.mjs\n',
)
