import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import Lateral from "@/components/panel/Lateral";
import Salir from "@/components/panel/Salir";
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

/**
 * El armazón del panel: menú a la izquierda, lienzo a la derecha.
 *
 * ⚠️ **Que este layout compruebe la sesión NO exime a las páginas.**
 *
 * Un layout que decide no dibujar a sus hijos no impide que esos hijos
 * se ejecuten en el servidor: la página de mensajes igual iría a buscar
 * los mensajes. Aquí se comprueba para no dibujar un menú a quien no ha
 * entrado, pero cada pantalla vuelve a comprobarlo por su cuenta antes
 * de leer nada. Parece repetido y no lo es.
 */
export default async function ArmazonDelPanel({ children }: { children: ReactNode }) {
    const sesion = await sesionActual();
    if (!sesion) redirect("/");

    const cliente = await clientePorClave(sesion.cliente);

    return (
        <div className="panel">
            <Lateral negocio={cliente?.nombre ?? sesion.cliente} />
            <main className="lienzo">
                <header className="lienzo-cabecera">
                    <span className="lienzo-quien">{sesion.email}</span>
                    <Salir />
                </header>
                {children}
            </main>
        </div>
    );
}
