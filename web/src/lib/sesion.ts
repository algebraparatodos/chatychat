/**
 * Quién entró: contraseñas y sesión.
 *
 * ── La contraseña no se guarda nunca ───────────────────────────────
 *
 * Se guarda de qué deriva. Aquí eso es **PBKDF2 con SHA-256**, y no
 * bcrypt ni argon2, porque esto corre en un Worker y lo único que hay es
 * `crypto.subtle`: no se puede cargar una librería nativa. PBKDF2 es más
 * débil frente a quien tenga tarjetas gráficas, y se compensa con
 * vueltas.
 *
 * Cada usuario lleva **su propia sal**, que no es secreta y por eso se
 * guarda al lado. Su trabajo es otro: sin ella, dos personas con la
 * misma contraseña tendrían el mismo resto y se reconocerían de un
 * vistazo mirando la tabla.
 *
 * Y las vueltas van **guardadas en la fila**, no fijas aquí. Así se
 * pueden subir el año que viene sin invalidar lo ya guardado: cada
 * contraseña se comprueba con las suyas.
 *
 * ── La sesión es una cookie firmada, no una tabla ──────────────────
 *
 * No hay tabla de sesiones a propósito. Una cookie firmada se comprueba
 * sin ir a la base, que en el borde es la diferencia entre responder en
 * un milisegundo o en treinta, y no deja basura que limpiar.
 *
 * Lo que se paga: **no se puede cerrar la sesión de alguien desde el
 * servidor** antes de que caduque. Con dos clientes es un precio
 * razonable; el día que haya que echar a alguien en el acto, el sitio
 * donde arreglarlo es éste, guardando una versión por usuario que
 * invalide lo firmado antes.
 */

/**
 * Las vueltas de PBKDF2.
 *
 * ⚠️ **100.000 es el máximo que admite Cloudflare. No se puede subir.**
 *
 * La recomendación de OWASP para PBKDF2-SHA256 es 210.000, y eso es lo
 * que había aquí. El runtime lo rechaza con
 * `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are
 * not supported`, y el síntoma es feo: la página de entrada carga bien y
 * el formulario devuelve un 500 al enviarlo. Comprobado el 23/09/2026
 * contra producción.
 *
 * O sea que si alguien lee «210.000 es lo recomendado» y sube esto, no
 * mejora nada: **rompe la entrada de todo el mundo**, y el error no
 * menciona las contraseñas por ningún lado.
 *
 * ── Qué compensa la diferencia ─────────────────────────────────────
 *
 * Menos vueltas es menos coste para quien robe la tabla y se ponga a
 * probar contraseñas. Lo que lo compensa es **el largo mínimo**, que
 * está en `registro.ts` y vale mucho más: cada carácter de más multiplica
 * el trabajo del atacante por el tamaño del alfabeto, mientras que
 * duplicar las vueltas sólo lo duplica.
 *
 * Y cuando de verdad haga falta más, la salida no es subir esto: es
 * cambiar de algoritmo. La columna `vueltas` se guarda por fila
 * justamente para poder migrar sin invalidar lo que ya hay.
 */
const VUELTAS = 100_000;

/**
 * Cuánto dura la sesión.
 *
 * Treinta días. Es un panel de trabajo que alguien abre cada mañana:
 * pedirle la contraseña cada día es lo que hace que la gente ponga
 * contraseñas cortas.
 */
const DIAS = 30;

export type Sesion = { email: string; cliente: string; hasta: number };

// ── Texto y bytes ────────────────────────────────────────────────

const aBytes = (t: string) => new TextEncoder().encode(t);

function aBase64Url(b: Uint8Array): string {
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(t: string): Uint8Array | null {
    try {
        const normal = t.replace(/-/g, "+").replace(/_/g, "/");
        const crudo = atob(normal + "=".repeat((4 - (normal.length % 4)) % 4));
        const b = new Uint8Array(crudo.length);
        for (let i = 0; i < crudo.length; i++) b[i] = crudo.charCodeAt(i);
        return b;
    } catch {
        return null;
    }
}

// ── Contraseñas ──────────────────────────────────────────────────

export function salNueva(): string {
    return aBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

async function derivar(clave: string, sal: string, vueltas: number): Promise<string> {
    const material = await crypto.subtle.importKey("raw", aBytes(clave), "PBKDF2", false, [
        "deriveBits",
    ]);
    // La sal se copia a un `Uint8Array` nuevo. No es ceremonia: el que
    // sale de `deBase64Url` puede estar respaldado por un buffer
    // compartido, y `deriveBits` sólo acepta uno normal.
    const sinDescifrar = deBase64Url(sal) ?? aBytes(sal);
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: new Uint8Array(sinDescifrar), iterations: vueltas, hash: "SHA-256" },
        material,
        256,
    );
    return aBase64Url(new Uint8Array(bits));
}

export async function hashDe(clave: string): Promise<{ hash: string; sal: string; vueltas: number }> {
    const sal = salNueva();
    return { hash: await derivar(clave, sal, VUELTAS), sal, vueltas: VUELTAS };
}

/**
 * ¿Es ésta la contraseña?
 *
 * La comparación va byte a byte con `timingSafeEqual` y no con `===`
 * porque `===` sobre cadenas corta en el primer byte distinto, y ese
 * tiempo distinto se mide desde fuera.
 */
export async function contrasenaVale(
    clave: string,
    guardado: { hash: string | null; sal: string | null; vueltas: number | null },
): Promise<boolean> {
    if (!guardado.hash || !guardado.sal || !guardado.vueltas) return false;
    const calculado = deBase64Url(await derivar(clave, guardado.sal, guardado.vueltas));
    const esperado = deBase64Url(guardado.hash);
    if (!calculado || !esperado || calculado.length !== esperado.length) return false;
    return crypto.subtle.timingSafeEqual(calculado, esperado);
}

// ── La cookie ────────────────────────────────────────────────────

export const COOKIE = "chatychat_sesion";

async function llave(secreto: string): Promise<CryptoKey> {
    return crypto.subtle.importKey("raw", aBytes(secreto), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
    ]);
}

export async function firmarSesion(
    s: Omit<Sesion, "hasta">,
    secreto: string,
): Promise<{ valor: string; segundos: number }> {
    const segundos = DIAS * 24 * 60 * 60;
    const cuerpo = aBase64Url(
        aBytes(JSON.stringify({ ...s, hasta: Date.now() + segundos * 1000 } satisfies Sesion)),
    );
    const firma = aBase64Url(
        new Uint8Array(await crypto.subtle.sign("HMAC", await llave(secreto), aBytes(cuerpo))),
    );
    return { valor: `${cuerpo}.${firma}`, segundos };
}

/** Devuelve la sesión si la firma es nuestra y no caducó, o `null`. */
export async function abrirSesion(valor: string | undefined, secreto: string): Promise<Sesion | null> {
    if (!valor || !valor.includes(".") || !secreto) return null;
    const [cuerpo, firma] = valor.split(".", 2);

    const esperada = deBase64Url(firma);
    const calculada = new Uint8Array(
        await crypto.subtle.sign("HMAC", await llave(secreto), aBytes(cuerpo)),
    );
    if (!esperada || esperada.length !== calculada.length) return null;
    if (!crypto.subtle.timingSafeEqual(calculada, esperada)) return null;

    try {
        const bytes = deBase64Url(cuerpo);
        if (!bytes) return null;
        const s = JSON.parse(new TextDecoder().decode(bytes)) as Sesion;
        // La caducidad va **dentro de lo firmado** y se comprueba acá.
        // Fiarse del `Max-Age` de la cookie sería fiarse del navegador,
        // que es justo la parte que no controlamos.
        if (!s?.email || !s?.cliente || typeof s.hasta !== "number") return null;
        return s.hasta > Date.now() ? s : null;
    } catch {
        return null;
    }
}
