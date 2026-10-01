/**
 * Las reglas de dar de alta a alguien.
 *
 * Están aparte de la acción que las usa para poder probarlas sin montar
 * un formulario ni una base.
 */

/**
 * La clave corta del cliente, a partir del nombre del negocio.
 *
 * ⚠️ **Sólo letras y números, sin guiones.** No es estética: la clave
 * forma el nombre del enlace a su base de datos en `wrangler.jsonc`,
 * `C_<clave>`, y eso tiene que ser un identificador válido. Un cliente
 * llamado «Acme-Shop» da `acmeshop`, no `acme-shop`, porque `C_acme-shop` no se puede
 * escribir en código.
 *
 * También forma el nombre de la base misma, así que **una vez elegida no
 * se cambia**: cambiarla obliga a crear otra base, migrar y redesplegar.
 */
export function claveDesde(nombre: string): string {
    const sinAcentos = nombre
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase();
    return sinAcentos.replace(/[^a-z0-9]/g, "").slice(0, 20);
}

export const LARGO_MINIMO = 10;

/**
 * ¿Sirve esta contraseña?
 *
 * Un mínimo de largo y nada más. Nada de «una mayúscula, un número y un
 * símbolo»: esas reglas no hacen las contraseñas más difíciles de
 * adivinar, hacen que la gente escriba `Password1!` y lo repita en todos
 * los sitios. El largo sí importa, y mucho.
 *
 * Se rechazan además las que están en la lista de las más usadas del
 * mundo, que es lo primero que prueba cualquiera.
 */
const DEMASIADO_VISTAS = new Set([
    "contrasena1",
    "contraseña1",
    "1234567890",
    "12345678910",
    "password12",
    "password123",
    "qwertyuiop",
    "administrador",
    "chatychat1",
    "instagram1",
]);

export function problemaDeLaClave(clave: string): string | null {
    if (clave.length < LARGO_MINIMO) {
        return `La contraseña tiene que tener al menos ${LARGO_MINIMO} caracteres.`;
    }
    if (DEMASIADO_VISTAS.has(clave.toLowerCase())) {
        return "Esa contraseña está entre las más usadas del mundo. Poné otra.";
    }
    return null;
}

/**
 * ¿Esto parece un correo?
 *
 * Deliberadamente flojo. La comprobación de verdad de que un correo
 * existe es mandarle algo, no una expresión regular: las que intentan
 * seguir la norma al pie de la letra son enormes y acaban rechazando
 * direcciones válidas de gente real, que es mucho peor que aceptar una
 * inválida.
 */
export function pareceCorreo(v: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}
