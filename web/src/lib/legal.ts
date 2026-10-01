/**
 * Los datos legales de ChatyChat.
 *
 * ── Por qué ChatyChat tiene los suyos y no reusa los de la empresa ─
 *
 * Porque **tratan datos distintos y decir lo contrario sería falso**.
 *
 * La política de la web de la empresa describe una web de servicios con un
 * formulario de contacto: dice que el único encargado del tratamiento es
 * Cloudflare y que no se comparten datos con nadie. Para esa web es
 * cierto.
 *
 * ChatyChat hace otra cosa: lee y guarda los **comentarios y mensajes de
 * los clientes de sus clientes** —gente que nunca ha oído hablar de
 * nosotros— y le manda ese texto a OpenAI para redactar la respuesta.
 * Declarar la política de la empresa como la de ChatyChat sería decirle a
 * Meta que sólo usamos Cloudflare y que no compartimos nada con nadie,
 * y eso deja de ser verdad el día que la IA conteste el primer
 * comentario.
 *
 * Es el mismo error que ya casi costó un rechazo de App Review con la
 * frase «no leemos ni guardamos los medios del cliente»: cómoda y falsa.
 *
 * ── Quién es responsable y quién encargado ─────────────────────────
 *
 * Esto es lo que más importa y lo que más se equivoca:
 *
 *   El **negocio** que contrata ChatyChat es el **responsable** de los
 *   datos de su gente. Son sus clientes, su cuenta y su conversación.
 *
 *   La sociedad titular de ChatyChat es su **encargado del tratamiento**: trata esos
 *   datos por cuenta del negocio y siguiendo sus instrucciones.
 *
 * Decirlo al revés —presentarnos como responsables— sería arrogarnos
 * unos datos que no son nuestros, y le impediría al cliente cumplir con
 * su propia normativa.
 */

/** El titular. Un producto no tiene personalidad jurídica: la tiene la sociedad. */
export const TITULAR = {
    // Marcadores. Van los datos registrales de la sociedad que explote el producto.
    razonSocial: "Your Company, S.L.",
    nif: "YOUR_TAX_ID",
    domicilio: "Your registered address",
    registro: "Your company registry entry",
    marca: "Your Company",
    correo: "hello@example.com",
    web: "https://example.com",
} as const;

export const PRODUCTO = {
    nombre: "ChatyChat",
    web: "https://app.example.com",
} as const;

/**
 * Quién más toca los datos, y para qué exactamente.
 *
 * ⚠️ **Esta lista tiene que estar completa.** Es la parte que un cliente
 * con asesoría mira, y la que un revisor comprueba. Añadir un proveedor
 * al producto y no añadirlo aquí convierte esta página en una
 * declaración falsa, que es peor que no tenerla.
 */
export const ENCARGADOS = [
    {
        nombre: "Cloudflare, Inc.",
        para: "alojar el servicio y guardar los datos",
        donde: "Las bases de datos están en Europa Occidental. El código se ejecuta en la red de Cloudflare, que puede procesar una petición fuera de la UE mientras la atiende.",
        web: "https://www.cloudflare.com/privacypolicy/",
    },
    {
        nombre: "OpenAI, L.L.C.",
        para: "redactar las respuestas",
        donde: "Se le envía el texto del comentario o mensaje y la información que el negocio haya cargado sobre sí mismo. No se le envían los identificadores de las personas ni sus nombres de usuario.",
        web: "https://openai.com/policies/privacy-policy/",
    },
    {
        nombre: "Meta Platforms, Inc.",
        para: "recibir y enviar los mensajes de Instagram",
        donde: "Es la propia Instagram. Los datos salen de ahí y vuelven ahí.",
        web: "https://privacycenter.instagram.com/policy",
    },
] as const;

/**
 * Cuánto se guarda cada cosa.
 *
 * Escrito como plazos concretos y no como «el tiempo necesario», que no
 * dice nada y no se puede comprobar.
 */
export const PLAZOS = [
    {
        que: "Comentarios y mensajes, con el nombre de usuario de quien escribió",
        cuanto: "Mientras el negocio sea cliente. Al darse de baja se borran con su cuenta.",
    },
    {
        que: "El texto que envió el asistente",
        cuanto: "Lo mismo. Es lo que permite al negocio ver qué se dijo en su nombre.",
    },
    {
        que: "Las solicitudes de borrado",
        cuanto: "Se atienden en 30 días y queda el código de la solicitud, sin datos de la persona.",
    },
] as const;

export const ULTIMA_ACTUALIZACION = "23 de septiembre de 2026";
