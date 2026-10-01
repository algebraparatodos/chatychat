"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { accesoPorEmail, anotarEntrada, correoLimpio, entorno } from "@/lib/control";
import { COOKIE, contrasenaVale, firmarSesion } from "@/lib/sesion";

/**
 * Entrar con correo y contraseña.
 *
 * ── Por qué el error es siempre el mismo ───────────────────────────
 *
 * «El correo o la contraseña no son correctos», tanto si el correo no
 * existe como si existe y la contraseña está mal. Distinguirlos ayuda a
 * quien se equivocó, pero también le dice a cualquiera **qué correos
 * están registrados**, que es media cuenta regalada: con esa lista se
 * puede ir a probar contraseñas sólo donde se sabe que hay alguien.
 *
 * ── Y por qué se calcula el hash aunque el correo no exista ────────
 *
 * Si al no encontrar el correo se contestara al instante, el tiempo de
 * respuesta diría lo que el mensaje calla: rápido es «no existe», lento
 * es «existe y fallaste». Se mide desde fuera sin ninguna herramienta
 * especial. Así que se hace el mismo trabajo en los dos casos.
 */
export async function entrar(
    _antes: { error?: string } | undefined,
    datos: FormData,
): Promise<{ error?: string }> {
    const email = correoLimpio(String(datos.get("email") ?? ""));
    const clave = String(datos.get("clave") ?? "");

    if (!email || !clave) {
        return { error: "Hacen falta el correo y la contraseña." };
    }

    const secreto = (await entorno()).SESION_SECRET;
    if (!secreto) {
        console.error("[entrar] falta SESION_SECRET");
        return { error: "El panel no está configurado del todo. Avisá al soporte." };
    }

    const acceso = await accesoPorEmail(email);

    const vale = acceso
        ? await contrasenaVale(clave, acceso)
        : // Trabajo en balde a propósito, para que tarde lo mismo. El
          // resultado se tira.
          await contrasenaVale(clave, {
              hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              sal: "AAAAAAAAAAAAAAAAAAAAAAA",
              vueltas: 210_000,
          });

    if (!acceso || !vale) {
        return { error: "El correo o la contraseña no son correctos." };
    }

    const { valor, segundos } = await firmarSesion(
        { email: acceso.email, cliente: acceso.cliente },
        secreto,
    );

    const tarro = await cookies();
    tarro.set(COOKIE, valor, {
        httpOnly: true, // Que no la lea el JavaScript de la página.
        secure: true, // Sólo por HTTPS. En .app no hay otra cosa.
        sameSite: "lax", // Corta el envío desde otros sitios.
        path: "/",
        maxAge: segundos,
    });

    await anotarEntrada(acceso.email);
    redirect("/panel");
}

/** Salir: se borra la cookie y punto. */
export async function salir(): Promise<void> {
    const tarro = await cookies();
    tarro.delete(COOKIE);
    redirect("/");
}
