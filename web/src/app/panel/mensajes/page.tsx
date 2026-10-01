import { redirect } from "next/navigation";

/**
 * Esta pantalla depende de quien la pida, asi que no se puede precalcular.
 * El porqué largo está en `src/app/page.tsx`.
 */
export const dynamic = "force-dynamic";

import { clientePorClave, objetoDelCliente, sesionActual } from "@/lib/control";

export const metadata = { title: "Mensajes" };

/**
 * El buzón: lo que le escribieron al negocio y lo que se contestó.
 *
 * ── Por qué es una pantalla aparte y no una pestaña de Comentarios ─
 *
 * Porque **un comentario es público y un mensaje no**, y eso cambia lo
 * que hay que enseñar y con qué cuidado se lee. Un comentario lleva
 * además el aviso que quedó a la vista de todos; un mensaje es una
 * conversación privada entre el negocio y una persona.
 *
 * Mezclarlos en una sola lista haría que el cliente tuviera que mirar
 * una etiqueta para saber si lo que está leyendo lo vio todo el mundo o
 * no. Eso es justo lo que no se puede dejar a la atención de nadie.
 *
 * ── Y por qué importa para el App Review ───────────────────────────
 *
 * `instagram_business_manage_messages` es uno de los tres permisos que
 * se piden, y Meta no revisa sólo que la app pueda leer mensajes: revisa
 * **qué hace con ellos**. Esta pantalla es la respuesta a esa pregunta,
 * y es lo que se enseña en la grabación de ese permiso.
 */
export default async function Mensajes() {
    const sesion = await sesionActual();
    if (!sesion) redirect("/");

    const cliente = await clientePorClave(sesion.cliente);
    const objeto = await objetoDelCliente(sesion.cliente);

    if (!objeto) {
        return (
            <div className="hueco">
                <h1>No pudimos leer tus mensajes</h1>
                <p>
                    Es un problema nuestro, no tuyo. Si sigue pasando, escribinos a{" "}
                    <a href="mailto:hello@example.com">hello@example.com</a>.
                </p>
            </div>
        );
    }

    const [lista, cuentas] = await Promise.all([objeto.mensajes(50), objeto.cuantosMensajes()]);

    if (!lista.length) {
        return (
            <div className="hueco">
                <h1>Todavía no te escribió nadie</h1>
                {cliente?.cuenta_ig ? (
                    <p>
                        Tu cuenta está conectada y el asistente está escuchando. En cuanto alguien
                        te mande un mensaje, aparece acá con lo que se le contestó.
                    </p>
                ) : (
                    <p>
                        Todavía no conectaste tu Instagram, así que no nos llega nada. Se hace desde{" "}
                        <a href="/panel">Inicio</a>.
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="lista">
            <header className="lista-cabecera">
                <h1>Mensajes</h1>
                <p>
                    {cuentas.total} en total · {cuentas.respondidos} contestados
                    {cuentas.conFallo > 0 && <> · {cuentas.conFallo} con problemas</>}
                </p>
            </header>

            <ol className="hilos">
                {lista.map((m) => (
                    <li key={m.id} className="hilo">
                        <div className="hilo-cabeza">
                            <b>{m.usuario ? `@${m.usuario}` : "alguien"}</b>
                            <time dateTime={m.creado}>{cuando(m.creado)}</time>
                        </div>

                        <p className="hilo-dijo">{m.texto || <i>(sin texto)</i>}</p>

                        {/*
                            Los mismos casos que en Comentarios y por el mismo
                            motivo: decir «no se contestó» de algo que sí se
                            contestó es peor que no decir nada. Aquí no se
                            enseña el aviso público, porque en el buzón no lo
                            hay: lo que se dijo, se dijo en privado.
                        */}
                        {m.respuesta ? (
                            <div className="hilo-respuesta">
                                <span className="hilo-quien">
                                    Le contestamos
                                    {m.origen === "ia" && <em>escrito por la IA</em>}
                                </span>
                                <p>{m.respuesta}</p>
                            </div>
                        ) : m.error ? (
                            <p className="hilo-mal">No se pudo contestar: {m.error}</p>
                        ) : m.respondido ? (
                            <p className="hilo-nada">
                                Se contestó, pero es de antes de que guardáramos el texto.
                            </p>
                        ) : m.automatizacion_id ? (
                            <p className="hilo-nada">
                                Disparó una automatización pero no llegó a salir.
                            </p>
                        ) : (
                            <p className="hilo-nada">
                                No disparó ninguna automatización, así que no se contestó.
                            </p>
                        )}
                    </li>
                ))}
            </ol>
        </div>
    );
}

/**
 * La fecha, en lo que le importa a quien mira.
 *
 * Igual que en Comentarios: quien abre esto quiere saber si es de ahora
 * o de la semana pasada, no la marca exacta.
 */
function cuando(iso: string): string {
    const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
    if (Number.isNaN(t)) return iso;

    const minutos = Math.floor((Date.now() - t) / 60000);
    if (minutos < 1) return "ahora mismo";
    if (minutos < 60) return `hace ${minutos} min`;
    if (minutos < 60 * 24) return `hace ${Math.floor(minutos / 60)} h`;

    return new Date(t).toLocaleDateString("es-ES", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}
