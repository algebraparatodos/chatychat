"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { control, correoLimpio, entorno } from "@/lib/control";
import { claveDesde, pareceCorreo, problemaDeLaClave } from "@/lib/registro";
import { COOKIE, firmarSesion, hashDe } from "@/lib/sesion";

/**
 * Darse de alta.
 *
 * ── Qué crea, y qué NO crea ────────────────────────────────────────
 *
 * Crea dos filas en la base de control: el negocio en `clientes` y la
 * persona en `accesos`.
 *
 * **No crea la base de datos del cliente**, y no puede. Cada cliente
 * tiene la suya, y para que el Worker la vea hace falta un enlace nuevo
 * en `wrangler.jsonc` y un despliegue. Eso no lo puede hacer una página
 * web, y tampoco queremos que pueda: el día que se pudiera, un fallo en
 * el formulario de registro sería un fallo con permiso para tocar la
 * configuración de la plataforma.
 *
 * Así que el negocio nace **en preparación** y el panel lo dice con esas
 * palabras. Lo termina `herramientas/alta-cliente.mjs`, que crea la base
 * y despliega.
 *
 * ── Y nace en pausa ────────────────────────────────────────────────
 *
 * Como manda la regla de la casa: un cliente nuevo existe pero el bot no
 * contesta por él hasta que alguien lo mira. Un asistente que empieza a
 * escribirle a la gente de un negocio en cuanto alguien rellena un
 * formulario es la forma más rápida de que nos cierren la app.
 */
export async function registrarse(
    _antes: { error?: string } | undefined,
    datos: FormData,
): Promise<{ error?: string }> {
    const negocio = String(datos.get("negocio") ?? "").trim();
    const email = correoLimpio(String(datos.get("email") ?? ""));
    const clave = String(datos.get("clave") ?? "");

    if (!negocio || !email || !clave) {
        return { error: "Hacen falta el nombre del negocio, el correo y la contraseña." };
    }
    if (!pareceCorreo(email)) {
        return { error: "Ese correo no parece un correo." };
    }
    const problema = problemaDeLaClave(clave);
    if (problema) return { error: problema };

    const llave = claveDesde(negocio);
    if (llave.length < 3) {
        return {
            error: "El nombre del negocio tiene que tener al menos tres letras o números.",
        };
    }

    const base = await control();
    const secreto = (await entorno()).SESION_SECRET;
    if (!base || !secreto) {
        console.error("[registro] falta la base de control o SESION_SECRET");
        return { error: "El panel no está configurado del todo. Avisá al soporte." };
    }

    try {
        if (await base.prepare(`SELECT 1 FROM accesos WHERE email = ?1`).bind(email).first()) {
            // Se dice claro, y es una excepción a propósito de la regla de
            // no revelar qué correos existen: en un registro hay que
            // decirlo, porque si no la persona no entiende por qué no
            // puede entrar. Lo que se cuida es no decirlo en la ENTRADA.
            return { error: "Ya hay una cuenta con ese correo. Probá a entrar." };
        }

        // La clave del cliente sale del nombre, así que dos negocios que
        // se llamen parecido pueden chocar. Se le añade un sufijo en vez
        // de fallar: quien se registra no tiene por qué saber que existe
        // algo llamado «clave del cliente».
        let clienteClave = llave;
        for (let i = 2; i < 100; i++) {
            const hay = await base
                .prepare(`SELECT 1 FROM clientes WHERE clave = ?1`)
                .bind(clienteClave)
                .first();
            if (!hay) break;
            clienteClave = `${llave}${i}`;
        }

        const { hash, sal, vueltas } = await hashDe(clave);

        await base.batch([
            base
                .prepare(
                    `INSERT INTO clientes (clave, nombre, estado, salud)
                     VALUES (?1, ?2, 'pausa', 'sin revisar')`,
                )
                .bind(clienteClave, negocio),
            base
                .prepare(
                    `INSERT INTO accesos (email, cliente, hash, sal, vueltas)
                     VALUES (?1, ?2, ?3, ?4, ?5)`,
                )
                .bind(email, clienteClave, hash, sal, vueltas),
            base
                .prepare(
                    `INSERT INTO movimientos (cliente, tipo, detalle)
                     VALUES (?1, 'alta', ?2)`,
                )
                .bind(clienteClave, `se registro ${email} desde la web`),
        ]);

        console.log(`[registro] alta de «${negocio}» (${clienteClave}) por ${email}`);

        const { valor, segundos } = await firmarSesion({ email, cliente: clienteClave }, secreto);
        const tarro = await cookies();
        tarro.set(COOKIE, valor, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            maxAge: segundos,
        });
    } catch (err) {
        console.error(`[registro] no se pudo dar de alta a ${email}: ${err}`);
        return { error: "No se pudo crear la cuenta. Probá otra vez en un momento." };
    }

    // Fuera del try: `redirect` funciona lanzando, y dentro del try lo
    // atraparia el catch y parecería un fallo del alta.
    redirect("/panel");
}
