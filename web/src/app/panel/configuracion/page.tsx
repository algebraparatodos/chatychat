import { redirect } from "next/navigation";

import SelectorDeTema from "@/components/panel/SelectorDeTema";
import { sesionActual } from "@/lib/control";

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

export const metadata = { title: "Apariencia" };

/**
 * Configuración → Apariencia.
 *
 * Hoy sólo el tema. Va en su propia pantalla y no metido en un rincón de
 * otra porque «Configuración» va a crecer —la cuenta, el Instagram, el
 * plan— y lo que nace como un apartado suelto dentro de otra pantalla
 * nunca se saca después.
 *
 * Comprueba la sesión aunque el `layout` ya la haya comprobado, por lo
 * mismo que todas: un layout que no dibuja a sus hijos no impide que
 * esos hijos se ejecuten en el servidor.
 */
export default async function Apariencia() {
    if (!(await sesionActual())) redirect("/");

    return (
        <div className="ajustes">
            <h1>Apariencia</h1>
            <p>Cómo se ve el panel. No cambia nada de lo que ven tus clientes.</p>

            <SelectorDeTema />
        </div>
    );
}
