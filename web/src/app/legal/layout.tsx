import type { ReactNode } from "react";
import Link from "next/link";

import { PRODUCTO, ULTIMA_ACTUALIZACION } from "@/lib/legal";

/**
 * La envoltura de las páginas legales de ChatyChat.
 *
 * ── Aquí no hay ningún aviso de borrador, y es deliberado ──────────
 *
 * Las páginas legales de la web de la empresa llevaban uno que decía que el texto
 * «no es válido legalmente». Se descubrió auditando la solicitud de App
 * Review: Meta abre la política de privacidad que declara la app, así
 * que un cartel de obra puesto para uno mismo se lee, desde fuera, como
 * que la empresa no tiene política de privacidad.
 *
 * Si algún día falta un dato aquí, **la línea de ese dato no se imprime
 * y ya**. Un hueco callado es mejor que un cartel de obra.
 */
export default function ArmazonLegal({ children }: { children: ReactNode }) {
    return (
        <main className="legal">
            <nav className="legal-migas">
                <Link href="/">{PRODUCTO.nombre}</Link>
                <span aria-hidden="true">·</span>
                <Link href="/legal/privacidad">Privacidad</Link>
                <Link href="/legal/aviso-legal">Aviso legal</Link>
                <Link href="/legal/eliminacion-de-datos">Borrar tus datos</Link>
            </nav>

            <article className="legal-texto">{children}</article>

            <p className="legal-fecha">Última actualización: {ULTIMA_ACTUALIZACION}</p>
        </main>
    );
}
