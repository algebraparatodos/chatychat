/**
 * El tema del panel: claro, oscuro o el que diga el sistema.
 *
 * Todo lo que sabe del tema está aquí. Las pantallas no leen
 * `localStorage` ni tocan el `<html>` por su cuenta, porque con dos
 * sitios que lo hagan ya hay dos formas de que se queden en desacuerdo.
 */

export const TEMAS = ["automatico", "claro", "oscuro"] as const;
export type Tema = (typeof TEMAS)[number];

/**
 * Dónde se guarda.
 *
 * Con nombre del producto delante porque el navegador comparte el
 * almacén con todo lo que sirva este dominio; un día habrá más de una
 * cosa en `app.example.com` y `tema` a secas sería de todas.
 */
export const LLAVE = "chatychat.tema";

export function esTema(v: unknown): v is Tema {
    return typeof v === "string" && (TEMAS as readonly string[]).includes(v);
}

/** Lo guardado, o «automático» si no hay nada o el navegador no deja. */
export function temaGuardado(): Tema {
    try {
        const v = window.localStorage.getItem(LLAVE);
        return esTema(v) ? v : "automatico";
    } catch {
        // Ventana privada, cookies bloqueadas, o el navegador de un
        // sistema corporativo. No es un fallo: es que no hay preferencia.
        return "automatico";
    }
}

/**
 * Lo escribe en el `<html>` y lo guarda.
 *
 * «automático» **quita** el atributo en vez de ponerlo en «automatico»,
 * y es lo que hace que la consulta de `prefers-color-scheme` vuelva a
 * mandar. Un atributo con un tercer valor no lo entendería el CSS.
 */
export function aplicarTema(tema: Tema): void {
    const html = document.documentElement;
    if (tema === "automatico") html.removeAttribute("data-tema");
    else html.setAttribute("data-tema", tema);

    try {
        if (tema === "automatico") window.localStorage.removeItem(LLAVE);
        else window.localStorage.setItem(LLAVE, tema);
    } catch {
        // Se queda aplicado en esta pestaña aunque no se pueda guardar.
        // Peor sería no hacer nada y que el botón pareciera roto.
    }
}

/**
 * El guion que corre **antes de la primera pintura**.
 *
 * Sin esto el panel se dibuja en claro y salta a oscuro cuando React
 * arranca: el fogonazo blanco que todo el mundo reconoce y que en una
 * pantalla que se abre a las siete de la mañana molesta de verdad.
 *
 * Va en el `<head>`, sin `async` ni `defer` y sin depender de React, que
 * para entonces todavía no existe. Por eso es una cadena de texto y no
 * un componente.
 */
export const GUION_SIN_FOGONAZO = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
    LLAVE,
)});if(t==="claro"||t==="oscuro"){document.documentElement.setAttribute("data-tema",t)}}catch(e){}})()`;
