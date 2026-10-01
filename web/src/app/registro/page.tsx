import Link from "next/link";
import { redirect } from "next/navigation";

import Registrarse from "@/components/panel/Registrarse";
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

export const metadata = { title: "Crear cuenta" };

export default async function Registro() {
    if (await sesionActual()) redirect("/panel");

    return (
        <main className="puerta">
            <div className="puerta-caja">
                <div className="puerta-marca">
                    <span className="puerta-punto" aria-hidden="true" />
                    <h1>Crear cuenta</h1>
                </div>
                <p className="puerta-bajada">
                    Creás la cuenta ahora y conectás tu Instagram cuando puedas. No hace falta que
                    tengas nada preparado.
                </p>

                <Registrarse />

                <p className="puerta-pie">
                    ¿Ya tenés cuenta? <Link href="/">Entrá</Link>.
                </p>
            </div>
        </main>
    );
}
