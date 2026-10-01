"use client";

import { useEffect, useState } from "react";

import { aplicarTema, temaGuardado, TEMAS, type Tema } from "@/lib/tema";

const COMO: Record<Tema, { titulo: string; explica: string }> = {
    automatico: { titulo: "Automático", explica: "El que tenga tu móvil u ordenador" },
    claro: { titulo: "Claro", explica: "Siempre claro, aunque el sistema esté oscuro" },
    oscuro: { titulo: "Oscuro", explica: "Siempre oscuro, aunque el sistema esté claro" },
};

/**
 * Elegir claro, oscuro o automático.
 *
 * ── Por qué arranca en blanco y se rellena después ─────────────────
 *
 * Porque **el servidor no sabe qué tema tiene esta persona**: la
 * elección vive en el navegador y no viaja en la petición. Si esto
 * dibujara «automático» marcado desde el servidor, a quien tiene elegido
 * «oscuro» le parpadearía la marca de un botón a otro al cargar.
 *
 * Así que hasta que el componente se monta no hay ninguno marcado, y es
 * un instante. La alternativa sería guardar el tema en una cookie para
 * que el servidor lo supiera, y eso es mandar una preferencia de
 * apariencia en cada petición de cada imagen: mucho peaje para lo que es.
 */
export default function SelectorDeTema() {
    const [tema, setTema] = useState<Tema | null>(null);

    useEffect(() => {
        setTema(temaGuardado());
    }, []);

    function elegir(t: Tema) {
        aplicarTema(t);
        setTema(t);
    }

    return (
        <fieldset className="temas">
            <legend>Tema</legend>
            <div className="temas-fila">
                {TEMAS.map((t) => (
                    <button
                        key={t}
                        type="button"
                        className="tema"
                        onClick={() => elegir(t)}
                        aria-pressed={tema === t}
                        data-elegido={String(tema === t)}
                    >
                        <span className="tema-muestra" data-tema={t} aria-hidden="true">
                            <i />
                            <i />
                        </span>
                        <b>{COMO[t].titulo}</b>
                        <em>{COMO[t].explica}</em>
                    </button>
                ))}
            </div>
            <p className="temas-nota">
                Se guarda en este navegador, así que no cambia el de tus compañeros ni el de tu
                teléfono.
            </p>
        </fieldset>
    );
}
