import Link from "next/link";
import { redirect } from "next/navigation";

import { sesionActual } from "@/lib/control";
import Entrar from "@/components/panel/Entrar";

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

/**
 * La portada de app.example.com: la puerta.
 *
 * Por ahora la web es esto y nada más. Las páginas de venta vienen
 * después; lo que hace falta hoy es que las dos personas que ya tienen
 * cuenta puedan entrar.
 *
 * Si ya hay sesión no se enseña el formulario: se va derecho al panel.
 * Un formulario de entrada delante de alguien que ya entró es una
 * pantalla que no hace falta y que hace dudar de si la sesión sigue
 * abierta.
 */
export default async function Portada() {
    if (await sesionActual()) redirect("/panel");

    return (
        <main className="puerta">
            <div className="puerta-caja">
                <div className="puerta-marca">
                    <span className="puerta-punto" aria-hidden="true" />
                    <h1>ChatyChat</h1>
                </div>
                <p className="puerta-bajada">
                    Asistentes que contestan los comentarios y los mensajes de Instagram de tu
                    negocio.
                </p>

                <Entrar />

                <p className="puerta-pie">
                    ¿Todavía no tenés cuenta? <Link href="/registro">Creá una</Link>.
                </p>
            </div>
        </main>
    );
}
