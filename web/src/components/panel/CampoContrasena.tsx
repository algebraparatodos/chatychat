"use client";

import { useId, useState } from "react";

/**
 * El campo de contraseña, con el ojo para verla.
 *
 * ── Por qué existe el ojo ──────────────────────────────────────────
 *
 * Porque los puntitos no protegen de nadie en la práctica: quien entra
 * a su panel suele estar solo, y lo que sí pasa constantemente es
 * escribir mal una contraseña larga y no saber dónde. Poder mirarla
 * convierte tres intentos fallidos en uno bueno.
 *
 * Las que generamos nosotros vienen en grupos con guiones —`357u-yf95-…`—
 * y son justo las que más se teclean mal.
 *
 * ── Tres detalles que parecen menores y no lo son ──────────────────
 *
 * **`type="button"`.** Un botón dentro de un formulario, sin tipo, es un
 * botón de envío: pulsar el ojo mandaría el formulario a medio escribir.
 * Es el error clásico de este componente.
 *
 * **Nace oculta, siempre.** Aunque alguien la hubiera dejado visible
 * antes; no se recuerda a propósito. Una contraseña visible al cargar la
 * página es la que acaba proyectada en una pantalla compartida.
 *
 * **La etiqueta dice lo que va a pasar, no lo que hay.** «Ver
 * contraseña» / «Ocultar contraseña», que es lo que un lector de
 * pantalla necesita oír para decidir si pulsa.
 */
export default function CampoContrasena({
    nombre,
    etiqueta,
    autoComplete,
    minLength,
    pista,
}: {
    nombre: string;
    etiqueta: string;
    autoComplete: "current-password" | "new-password";
    minLength?: number;
    pista?: string;
}) {
    const [visible, setVisible] = useState(false);
    const id = useId();

    return (
        <>
            <label htmlFor={id}>{etiqueta}</label>
            <div className="clave-caja">
                <input
                    id={id}
                    name={nombre}
                    type={visible ? "text" : "password"}
                    autoComplete={autoComplete}
                    minLength={minLength}
                    required
                />
                <button
                    type="button"
                    className="clave-ojo"
                    onClick={() => setVisible((v) => !v)}
                    aria-label={visible ? "Ocultar contraseña" : "Ver contraseña"}
                    aria-pressed={visible}
                    title={visible ? "Ocultar contraseña" : "Ver contraseña"}
                >
                    <Ojo tachado={visible} />
                </button>
            </div>
            {pista && <p className="entrar-pista">{pista}</p>}
        </>
    );
}

/**
 * El icono.
 *
 * Dibujado a mano y no traído de una librería de iconos: son doce líneas
 * y ahorra una dependencia entera que habría que cargar en el navegador
 * de alguien sólo para esto.
 *
 * Cuando la contraseña está a la vista el ojo aparece **tachado**, que es
 * el convenio que todo el mundo reconoce: el icono muestra la acción que
 * queda por hacer, no el estado actual.
 */
function Ojo({ tachado }: { tachado: boolean }) {
    return (
        <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
            <circle cx="12" cy="12" r="2.6" />
            {tachado && <line x1="4" y1="20" x2="20" y2="4" />}
        </svg>
    );
}
