"use client";

import { useActionState } from "react";

import CampoContrasena from "@/components/panel/CampoContrasena";
import { entrar } from "@/app/acciones";

/**
 * El formulario de entrada.
 *
 * ── Por qué es de cliente si la acción es de servidor ──────────────
 *
 * Por el error. Un formulario normal manda y recarga, y para enseñar
 * «la contraseña no es correcta» habría que volver con el error en la
 * URL —donde se queda al compartir el enlace o al volver atrás— o
 * guardarlo en algún sitio. `useActionState` lo devuelve donde estaba
 * escrito el formulario, sin recargar y sin dejar rastro.
 *
 * La comprobación sigue entera en el servidor: esto sólo pinta lo que
 * aquélla contesta.
 */
export default function Entrar() {
    const [estado, accion, enviando] = useActionState(entrar, {});

    return (
        <form action={accion} className="entrar">
            <label htmlFor="email">Correo</label>
            <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                placeholder="vos@tunegocio.com"
            />

            <CampoContrasena
                nombre="clave"
                etiqueta="Contraseña"
                autoComplete="current-password"
            />

            {/* `role="alert"` para que un lector de pantalla lo diga al
                aparecer, en vez de dejar a alguien esperando sin saber
                que el formulario ya contestó. */}
            {estado?.error && (
                <p className="entrar-mal" role="alert">
                    {estado.error}
                </p>
            )}

            <button type="submit" disabled={enviando}>
                {enviando ? "Entrando…" : "Entrar"}
            </button>
        </form>
    );
}
