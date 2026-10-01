"use client";

import { useEffect } from "react";

/**
 * Enciende las transiciones de color **después** de la primera pintura.
 *
 * Si `body` las tuviera desde el principio, el propio arranque del panel
 * se vería como un desvanecido de gris a color. Se quieren al cambiar de
 * tema, no al entrar.
 */
export default function Listo() {
    useEffect(() => {
        document.body.classList.add("listo");
    }, []);
    return null;
}
