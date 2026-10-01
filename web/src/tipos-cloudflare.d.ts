/**
 * Lo que el runtime de Cloudflare añade y TypeScript no ve.
 *
 * ── Por qué hace falta declarar esto a mano ────────────────────────
 *
 * Este panel es una aplicación de Next.js, así que TypeScript carga los
 * tipos del navegador (`lib.dom`). Ahí `SubtleCrypto` es la de la norma
 * web, que **no tiene `timingSafeEqual`**.
 *
 * Pero el código no corre en un navegador: corre en el runtime de
 * Cloudflare, donde `crypto.subtle.timingSafeEqual` sí existe —es una
 * extensión suya— y es la que usa el Worker del webhook desde hace días,
 * en producción.
 *
 * O sea que el error no dice «esto no funciona», dice «los tipos del
 * navegador no lo conocen». Se declara aquí, con el porqué al lado, en
 * vez de poner un `as any` en los dos sitios donde se usa.
 *
 * ── Por qué no se escribe a mano una comparación constante ─────────
 *
 * Porque una comparación en tiempo constante escrita a mano es fácil de
 * escribir mal y **cuando está mal no falla**: pasa las pruebas, compara
 * bien, y sólo filtra información por lo que tarda. Teniendo la
 * primitiva del runtime, usarla es más seguro que reimplementarla.
 */

interface SubtleCrypto {
    /**
     * Compara dos buffers **del mismo largo** en tiempo constante.
     *
     * ⚠️ Lanza si los largos no coinciden, así que hay que comprobarlo
     * antes. Eso no filtra nada: el largo de un hash es público.
     */
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
}
