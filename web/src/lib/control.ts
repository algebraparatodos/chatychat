import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";

import { abrirSesion, type Sesion } from "@/lib/sesion";

/**
 * La puerta a la base de control, a quién está dentro y a su objeto.
 *
 * ── Por qué todo pasa por aquí ─────────────────────────────────────
 *
 * Porque hay **dos sitios distintos** donde viven los datos y confundirlos
 * es el error caro:
 *
 *   La base de control, una sola para toda la plataforma: quién es cada
 *   cliente, su token, su estado.
 *
 *   El objeto de cada cliente, uno por negocio: sus comentarios, sus
 *   mensajes, sus automatizaciones.
 *
 * Si cada pantalla alcanzara el objeto por su cuenta, tarde o temprano
 * una alcanzaría el del cliente equivocado y le enseñaría a un negocio
 * las conversaciones de otro. Aquí se hace en un solo sitio y siempre a
 * partir de la sesión, que es lo que dice de quién es cada pantalla.
 */

/**
 * Lo que el panel le pide al objeto de un cliente.
 *
 * ── Por qué se declara aquí y no se importa la clase ───────────────
 *
 * Porque la clase `Cliente` vive en el otro proyecto, el del webhook.
 * Importarla desde aquí ataría los dos: cualquier cosa que ese archivo
 * importe —el esquema, los envíos a Meta— acabaría arrastrada al bundle
 * del panel, que no la necesita.
 *
 * Declarando sólo los métodos que se usan, el contrato entre los dos
 * queda escrito y a la vista. Si allí se cambia la forma de uno, aquí
 * deja de compilar, que es exactamente cuando hay que enterarse.
 */
/**
 * Una cosa que llegó y lo que se hizo con ella.
 *
 * Es el mismo tipo que declara el Worker en `src/cliente.ts`. Está
 * copiado y no importado porque **son dos Workers distintos**: el panel
 * no comparte código con el bot, sólo el contrato de estos métodos. Si
 * allí se añade un campo, hay que añadirlo aquí, y hasta entonces el
 * panel sencillamente no lo ve.
 */
export type Atendido = {
    id: number;
    usuario: string | null;
    texto: string | null;
    media_id: string | null;
    respondido: number;
    automatizacion_id: number | null;
    respuesta: string | null;
    aviso_enviado: string | null;
    origen: string | null;
    error: string | null;
    creado: string;
};

export type Cuentas = { total: number; respondidos: number; conFallo: number };

export type ObjetoDeCliente = {
    comentarios(limite?: number, desde?: number): Promise<Atendido[]>;
    cuantosComentarios(): Promise<Cuentas>;
    mensajes(limite?: number, desde?: number): Promise<Atendido[]>;
    cuantosMensajes(): Promise<Cuentas>;
};

type Entorno = {
    CONTROL?: D1Database;
    CLIENTES?: DurableObjectNamespace;
    SESION_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
} & Record<string, unknown>;

export async function entorno(): Promise<Entorno> {
    const { env } = await getCloudflareContext({ async: true });
    return env as Entorno;
}

export async function control(): Promise<D1Database | null> {
    try {
        return (await entorno()).CONTROL ?? null;
    } catch {
        return null;
    }
}

export type Acceso = {
    email: string;
    cliente: string;
    hash: string | null;
    sal: string | null;
    vueltas: number | null;
    google: string | null;
    nombre: string | null;
};

export type Cliente = {
    clave: string;
    nombre: string;
    cuenta_ig: string | null;
    estado: string;
    salud: string;
    token: string | null;

    /**
     * Por cuál de los dos caminos de Meta va este cliente.
     *
     * 'instagram' si su cuenta está sólo en Instagram, 'facebook' si
     * está enlazada a una Página, y vacío si todavía no se sabe —que es
     * como nace todo el mundo, porque **no se puede saber antes de que
     * autorice**.
     *
     * El panel lo usa para mandarle al enlace bueno. Si está vacío se le
     * manda por el de Instagram, que es el que además averigua cuál le
     * toca de verdad.
     */
    flujo: string | null;
    /**
     * Sobra desde la mudanza a Durable Objects, y se queda por ahora.
     *
     * Guardaba el identificador de la base D1 del cliente, que era lo que
     * había que crear antes de poder atenderle. Ya no hay nada que crear:
     * su objeto existe desde que se le nombra, así que **un cliente
     * recién registrado ya está listo** y no hay estado «en preparación».
     *
     * La columna se conserva mientras las bases D1 viejas sigan ahí como
     * copia de seguridad. Cuando se borren, se borra también.
     */
    base_id: string | null;
};

/**
 * El correo, normalizado.
 *
 * Minúsculas y sin espacios alrededor. Sin esto, quien se registra como
 * `Ana@example.com` y luego escribe `ana@example.com` se queda fuera de su
 * propia cuenta sin entender por qué, que es de las formas más tontas de
 * perder a alguien.
 */
export function correoLimpio(v: string): string {
    return v.trim().toLowerCase();
}

export async function accesoPorEmail(email: string): Promise<Acceso | null> {
    const base = await control();
    if (!base) return null;
    try {
        return await base
            .prepare(
                `SELECT email, cliente, hash, sal, vueltas, google, nombre
                   FROM accesos WHERE email = ?1`,
            )
            .bind(correoLimpio(email))
            .first<Acceso>();
    } catch (err) {
        console.error(`[control] no se pudo leer el acceso de ${email}: ${err}`);
        return null;
    }
}

export async function clientePorClave(clave: string): Promise<Cliente | null> {
    const base = await control();
    if (!base) return null;
    try {
        return await base
            .prepare(
                `SELECT clave, nombre, cuenta_ig, estado, salud, token, base_id, flujo
                   FROM clientes WHERE clave = ?1`,
            )
            .bind(clave)
            .first<Cliente>();
    } catch (err) {
        console.error(`[control] no se pudo leer el cliente ${clave}: ${err}`);
        return null;
    }
}

export async function anotarEntrada(email: string): Promise<void> {
    const base = await control();
    if (!base) return;
    try {
        await base
            .prepare(`UPDATE accesos SET ultimo = datetime('now') WHERE email = ?1`)
            .bind(correoLimpio(email))
            .run();
    } catch {
        // Que no se pueda anotar la última entrada no es motivo para no
        // dejar entrar a nadie.
    }
}

/**
 * Quién está dentro, o `null`.
 *
 * ⚠️ **Esto lo llama cada página, no el `layout`.**
 *
 * Un `layout` que decide no dibujar a sus hijos **no impide que esos
 * hijos se ejecuten en el servidor**: la página igual va a buscar sus
 * datos. En un panel multicliente eso significa leer los mensajes de un
 * negocio para luego no enseñarlos, que es exactamente lo que no puede
 * pasar. Así que la comprobación se repite en cada pantalla y en cada
 * acción, aunque parezca repetida.
 */
export async function sesionActual(): Promise<Sesion | null> {
    const secreto = (await entorno()).SESION_SECRET;
    if (!secreto) {
        console.error("[control] falta SESION_SECRET: nadie puede entrar");
        return null;
    }
    const tarro = await cookies();
    return abrirSesion(tarro.get("chatychat_sesion")?.value, secreto);
}

/**
 * El objeto de un cliente, o `null` si el enlace no está.
 *
 * Devuelve `null` en vez de lanzar porque el panel tiene que poder
 * dibujar algo aunque esto falle: una pantalla que dice «no se pudieron
 * leer tus comentarios» es mucho mejor que una pantalla en blanco con un
 * error de servidor.
 */
export async function objetoDelCliente(clave: string): Promise<ObjetoDeCliente | null> {
    try {
        const env = await entorno();
        if (!env.CLIENTES) {
            console.error("[control] falta el enlace CLIENTES: el panel no puede leer nada");
            return null;
        }
        const ns = env.CLIENTES;
        return ns.get(ns.idFromName(clave)) as unknown as ObjetoDeCliente;
    } catch (err) {
        console.error(`[control] no se pudo alcanzar el objeto de ${clave}: ${err}`);
        return null;
    }
}
