import { redirect } from "next/navigation";

import { clientePorClave, sesionActual } from "@/lib/control";

/**
 * Esta pantalla depende de quien la pida, asi que no se puede precalcular.
 *
 * Sin esto Next la marca como estatica —lo comprobo en el build del
 * 23/09/2026, que las listo todas como `○ Static`— y una pagina estatica
 * se sirve igual a todo el mundo: quien ya entro seguiria viendo el
 * formulario de entrada, y el panel no sabria de quien es.
 *
 * Normalmente `cookies()` basta para que Next lo deduzca solo. Aqui no
 * llega a leerse durante el build, porque sin entorno de Cloudflare la
 * comprobacion se rinde antes. Asi que se dice explicitamente, que
 * ademas se lee mejor que depender de una deduccion.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Inicio" };

/**
 * Lo primero que ve alguien que acaba de comprar.
 *
 * ── Por qué esta pantalla existe y no es un resumen con números ────
 *
 * Porque quien acaba de comprar **no tiene números**. No tiene
 * comentarios contestados, ni mensajes, ni automatizaciones. Un panel
 * lleno de ceros y de gráficos vacíos es la peor primera impresión que
 * se puede dar: parece que el producto no hace nada.
 *
 * Lo que sí tiene es una cosa pendiente, y es siempre la misma:
 * **conectar su Instagram**. Así que la pantalla es esa tarea, grande y
 * sola, hasta que está hecha. Después se convierte en el resumen.
 *
 * ── La conexión no la hace este panel ──────────────────────────────
 *
 * Se va al Worker, `webhook.example.com/conectar/<clave>`, que es el que
 * tiene las llaves de la app de Meta y el único que puede canjear el
 * código por un token. Que el panel no toque eso no es una molestia: es
 * lo que hace que un fallo aquí no pueda comprometer las credenciales de
 * la plataforma.
 */
export default async function Inicio() {
    const sesion = await sesionActual();
    if (!sesion) redirect("/");

    const cliente = await clientePorClave(sesion.cliente);
    if (!cliente) {
        return (
            <div className="hueco">
                <h1>No encontramos tu negocio</h1>
                <p>
                    Tu cuenta existe pero no está enlazada a ningún negocio. Esto lo tenemos que
                    arreglar nosotros: escribinos a <a href="mailto:hello@example.com">hello@example.com</a>.
                </p>
            </div>
        );
    }

    const conectado = Boolean(cliente.cuenta_ig && cliente.token);
    // ── A cada cliente, su camino ─────────────────────────────────
    //
    // Meta tiene dos formas de autorizar y cuál toca lo decide la cuenta
    // del cliente, no nosotros: si su Instagram está enlazado a una
    // Página de Facebook, el flujo de Instagram no le sirve.
    //
    // Nadie sabe, ni tiene por qué saber, si su cuenta tiene Página. Así
    // que **el botón es uno solo** y aquí se elige por detrás: si ya
    // sabemos que tiene Página —porque un intento anterior lo averiguó—
    // se le manda por Facebook; si no, por Instagram, que además es el
    // que lo averigua.
    const enlace =
        cliente.flujo === "facebook"
            ? `https://webhook.example.com/conectar-facebook/${cliente.clave}`
            : `https://webhook.example.com/conectar/${cliente.clave}`;

    if (!conectado) {
        return (
            <div className="arranque">
                <p className="arranque-paso">Primer paso</p>
                <h1>Conectá tu cuenta de Instagram</h1>
                <p className="arranque-texto">
                    Es lo único que hace falta para empezar. Vas a ver la pantalla de Instagram
                    pidiéndote permiso, aceptás, y volvés acá. Tarda menos de un minuto.
                </p>

                <a className="boton" href={enlace}>
                    Conectar Instagram
                </a>

                <div className="arranque-aparte">
                    <h2>Qué le estás permitiendo, exactamente</h2>
                    <ul>
                        <li>
                            <b>Leer los comentarios</b> de tus publicaciones, para poder contestarlos.
                        </li>
                        <li>
                            <b>Contestar por privado</b> a quien comenta, y responder los mensajes que
                            te escriban.
                        </li>
                        <li>
                            <b>Ver tus publicaciones</b> —la miniatura y el pie— para que puedas elegir
                            en cuál actúa cada automatización.
                        </li>
                    </ul>
                    <p>
                        No publicamos nada en tu nombre, no escribimos a nadie que no te haya escrito
                        antes, y podés desconectarnos desde Instagram cuando quieras.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="hueco">
            <h1>Todo listo</h1>
            <p>
                Tu cuenta está conectada y {cliente.estado === "alta" ? "el asistente está atendiendo" : "el asistente está en pausa"}.
            </p>
            {/*
              * Antes aquí decía que las pantallas «llegan en los próximos
              * días». Se quitó el 24/09/2026 por lo mismo que las entradas
              * «pronto» del menú: Meta graba este panel para revisar la app,
              * y una frase que anuncia lo que falta hace que el revisor lea
              * «producto a medias».
              *
              * En su lugar, lo que sí puede hacer ahora mismo. Un panel dice
              * lo que se puede hacer, no lo que todavía no.
              */}
            <p className="hueco-flojo">
                En <strong>Comentarios</strong> ves todo lo que te escribieron y lo que se contestó
                en tu nombre.
            </p>
        </div>
    );
}
