import { redirect } from "next/navigation";

/**
 * Esta pantalla depende de quien la pida, asi que no se puede precalcular.
 * El porqué largo está en `src/app/page.tsx`.
 */
export const dynamic = "force-dynamic";

import { clientePorClave, objetoDelCliente, sesionActual } from "@/lib/control";

export const metadata = { title: "Comentarios" };

/**
 * Los comentarios que llegaron y lo que el bot contestó.
 *
 * ── Por qué esto no es una cola de trabajo ─────────────────────────
 *
 * Porque no hay nada que aprobar. El bot contesta solo y en segundos:
 * para cuando el cliente abre el panel, ya está hecho. Lo que necesita
 * no es una bandeja de pendientes, es **leer lo que se dijo en su
 * nombre**, que es lo primero que quiere ver cualquiera que deja a un
 * asistente hablando con su gente.
 *
 * De ahí la forma: una lista en orden, lo más nuevo arriba, con el
 * comentario y la respuesta pegados. Sin casillas, sin botones de
 * aprobar y sin estados intermedios.
 *
 * ── Y por qué se ve de dónde salió cada respuesta ──────────────────
 *
 * Porque una escrita por la IA y una de plantilla no son lo mismo para
 * quien las lee. Esconder la diferencia sería engañar al cliente sobre
 * su propio producto, y además es justo lo que va a querer mirar cuando
 * algo suene raro.
 */
export default async function Comentarios() {
    const sesion = await sesionActual();
    if (!sesion) redirect("/");

    const cliente = await clientePorClave(sesion.cliente);
    const objeto = await objetoDelCliente(sesion.cliente);

    if (!objeto) {
        return (
            <div className="hueco">
                <h1>No pudimos leer tus comentarios</h1>
                <p>
                    Es un problema nuestro, no tuyo. Si sigue pasando, escribinos a{" "}
                    <a href="mailto:hello@example.com">hello@example.com</a>.
                </p>
            </div>
        );
    }

    const [lista, cuentas] = await Promise.all([
        objeto.comentarios(50),
        objeto.cuantosComentarios(),
    ]);

    if (!lista.length) {
        return (
            <div className="hueco">
                <h1>Todavía no llegó ningún comentario</h1>
                {cliente?.cuenta_ig ? (
                    <p>
                        Tu cuenta está conectada y el asistente está escuchando. En cuanto alguien
                        comente en una de tus publicaciones, aparece acá con lo que se le contestó.
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
                <h1>Comentarios</h1>
                <p>
                    {cuentas.total} en total · {cuentas.respondidos} contestados
                    {cuentas.conFallo > 0 && <> · {cuentas.conFallo} con problemas</>}
                </p>
            </header>

            <ol className="hilos">
                {lista.map((c) => (
                    <li key={c.id} className="hilo">
                        <div className="hilo-cabeza">
                            <b>{c.usuario ? `@${c.usuario}` : "alguien"}</b>
                            <time dateTime={c.creado}>{cuando(c.creado)}</time>
                        </div>

                        <p className="hilo-dijo">{c.texto || <i>(sin texto)</i>}</p>

                        {/*
                            Tres casos, y hay que distinguirlos: decir «no
                            se contestó» de algo que sí se contestó es
                            peor que no decir nada. Los comentarios
                            migrados de antes de septiembre estan
                            contestados pero sin el texto guardado, porque
                            esa columna no existia entonces.
                        */}
                        {c.respuesta ? (
                            <div className="hilo-respuesta">
                                <span className="hilo-quien">
                                    Le contestamos
                                    {c.origen === "ia" && <em>escrito por la IA</em>}
                                </span>
                                <p>{c.respuesta}</p>
                                {c.aviso_enviado && (
                                    <p className="hilo-publico">
                                        Y en público: <span>{c.aviso_enviado}</span>
                                    </p>
                                )}
                            </div>
                        ) : c.error ? (
                            <p className="hilo-mal">No se pudo contestar: {c.error}</p>
                        ) : c.respondido ? (
                            <p className="hilo-nada">
                                Se contestó, pero es de antes de que guardáramos el texto.
                            </p>
                        ) : c.automatizacion_id ? (
                            <p className="hilo-nada">Disparó una automatización pero no llegó a salir.</p>
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
 * «hace 3 min» y no «2026-09-23 14:02:11». Quien abre esto quiere saber
 * si es de ahora o de la semana pasada, no la marca exacta. A partir de
 * un día se pone la fecha, que es cuando el «hace X» deja de ayudar.
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
