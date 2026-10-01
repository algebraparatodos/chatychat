"use client";

import { useActionState } from "react";

import CampoContrasena from "@/components/panel/CampoContrasena";
import { registrarse } from "@/app/registro/acciones";
import { LARGO_MINIMO } from "@/lib/registro";

/**
 * El formulario de alta.
 *
 * Tres campos y ninguno de más. Cada campo que se añade aquí es gente
 * que se va antes de terminar, y el teléfono, el sector o el tamaño de
 * la empresa se pueden preguntar después, cuando ya hay una relación.
 *
 * La comprobación de verdad está en el servidor; lo de aquí —el
 * `minLength`, el `type="email"`— es sólo para que el navegador avise
 * antes de mandar. Nunca es la defensa.
 */
export default function Registrarse() {
    const [estado, accion, enviando] = useActionState(registrarse, {});

    return (
        <form action={accion} className="entrar">
            <label htmlFor="negocio">Nombre de tu negocio</label>
            <input
                id="negocio"
                name="negocio"
                type="text"
                required
                autoFocus
                maxLength={60}
                placeholder="Taller Luna Azul"
            />

            <label htmlFor="email">Correo</label>
            <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="vos@tunegocio.com"
            />

            <CampoContrasena
                nombre="clave"
                etiqueta="Contraseña"
                autoComplete="new-password"
                minLength={LARGO_MINIMO}
                pista={`Al menos ${LARGO_MINIMO} caracteres. Cuanto más larga, mejor.`}
            />

            {estado?.error && (
                <p className="entrar-mal" role="alert">
                    {estado.error}
                </p>
            )}

            <button type="submit" disabled={enviando}>
                {enviando ? "Creando tu cuenta…" : "Crear cuenta"}
            </button>
        </form>
    );
}
