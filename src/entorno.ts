import type { Cliente } from './cliente'

/**
 * Lo que el Worker recibe de Cloudflare.
 *
 * Vive en su propio modulo y no dentro de `base.ts` por un motivo
 * concreto: `base.ts` necesita el tipo del objeto de cliente y el objeto
 * de cliente necesita `Env`. Con los dos en el mismo archivo eso es un
 * circulo, y TypeScript lo resuelve a medias y de formas que se notan
 * tarde.
 */
export interface Env {
    /**
     * La base de la plataforma: qué clientes hay, sus credenciales y su
     * estado. Una sola, y es la única con nombre fijo.
     */
    CONTROL: D1Database

    /**
     * Los clientes. Uno por negocio, creado al nombrarlo.
     *
     * Antes aquí había una firma abierta, `[clave: string]: unknown`, que
     * existía sólo para poder buscar el enlace `C_<clave>` de cada
     * cliente. Esa firma se llevaba por delante los tipos de todo `Env`:
     * cualquier nombre mal escrito compilaba y devolvía `undefined`.
     *
     * Ya no hace falta y por eso no está. Un objeto se alcanza por
     * nombre, `env.CLIENTES.get(env.CLIENTES.idFromName(clave))`, sin
     * declarar nada y sin desplegar.
     */
    CLIENTES: DurableObjectNamespace<Cliente>

    /**
     * La llave de la puerta de servicio, `/admin/*`.
     *
     * Aparte del secreto de las sesiones del panel y de los de Meta a
     * proposito: es una llave de mantenimiento, y tiene que poder
     * rotarse sin echar a nadie de su panel ni tocar el webhook.
     *
     * Si no esta puesta, la puerta no existe. Es la direccion segura:
     * una herramienta que no puede mirar los datos es una molestia; una
     * puerta abierta sin llave es otra cosa.
     */
    ADMIN_TOKEN?: string

    /**
     * Con esto Meta firma cada webhook que manda: la clave secreta de la
     * app, la de `Configuración > Básica`.
     */
    META_APP_SECRET: string

    /**
     * La clave secreta de la **app de Instagram**, que es otra.
     *
     * Un caso de uso de Instagram trae su propia app, con identificador y
     * clave aparte de los de la app de Meta, y las dos pueden acabar
     * apuntando al mismo webhook firmando cada una con la suya. Es
     * opcional porque puede no haberla; si la hay y falta aquí, se cae
     * la mitad de lo que llega y el síntoma es idéntico al de tener mal
     * el otro secreto.
     */
    META_APP_SECRET_INSTAGRAM?: string

    /**
     * La clave secreta de la **segunda app**, la de Facebook Login.
     *
     * Y con esto ya son tres. No es desorden nuestro: Meta no deja las
     * dos configuraciones del caso de uso de Instagram en la misma app
     * —«You can only add one setup per app»— asi que atender a todos los
     * clientes obliga a dos apps, y cada app firma con lo suyo.
     *
     * ⚠️ **Todo lo que compruebe una firma tiene que probar las tres.**
     * Una que falte no da error en ningun sitio: sencillamente se cae la
     * parte de los eventos que venga de esa app, y el sintoma es «a estos
     * clientes no les contesta el bot». Ya paso una vez con dos.
     */
    META_APP_SECRET_FACEBOOK?: string

    /** El identificador de esa segunda app. No es secreto. */
    META_FACEBOOK_APP_ID?: string

    /**
     * La configuracion de «Facebook Login for Business».
     *
     * No es una lista de permisos: es el identificador de una
     * configuracion creada en el panel, que lleva dentro los permisos y
     * la pantalla que ve el cliente. Va en el enlace de login y **no es
     * secreto**.
     *
     * Sin esto el login seria el de Facebook de toda la vida, con una
     * lista cruda de permisos, y no el de empresas.
     */
    META_FACEBOOK_CONFIG_ID?: string

    /**
     * El identificador de la app de Instagram, el del caso de uso.
     *
     * Hace falta para mandar al cliente a autorizar. No es secreto: sale
     * en la URL que ve en el navegador.
     */
    META_INSTAGRAM_APP_ID?: string

    /**
     * Con esto se manda el correo de aviso cuando un cliente deja de
     * recibir. Opcional: sin ella todo sigue funcionando y lo único
     * que se pierde es el empujón, porque el estado queda igual
     * guardado en la base.
     */
    RESEND_API_KEY?: string

    /** El token de verificación del webhook, que lo inventamos nosotros. */
    META_VERIFY_TOKEN: string
}
