import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, IBM_Plex_Mono } from "next/font/google";

import "./globals.css";
import "./componentes.css";
import { GUION_SIN_FOGONAZO } from "@/lib/tema";
import Listo from "@/components/panel/Listo";

const archivo = Archivo({
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
    variable: "--tipo-ui",
    display: "swap",
});

const mono = IBM_Plex_Mono({
    subsets: ["latin"],
    weight: ["400", "500"],
    variable: "--tipo-mono",
    display: "swap",
});

export const metadata: Metadata = {
    /*
     * De dónde cuelga todo lo que Next escribe como dirección absoluta.
     *
     * Sin esto, `og:image` sale como `http://localhost:3000/...` **en
     * producción**, y no falla nada: la página carga, el icono se ve, y
     * lo único que pasa es que al compartir el enlace por WhatsApp o
     * LinkedIn no aparece la imagen, porque el que la pide es el
     * servidor de ellos y ahí no hay ningún localhost.
     *
     * Se descubrió el 24/09/2026 leyendo el HTML de app.example.com
     * después de desplegar. Mirar la web con el navegador no lo habría
     * enseñado nunca.
     */
    metadataBase: new URL("https://app.example.com"),
    title: { default: "ChatyChat", template: "%s · ChatyChat" },
    description:
        "Asistentes que contestan los comentarios y mensajes de Instagram de un negocio.",
    robots: { index: false, follow: false, nocache: true },
};

export default function Raiz({ children }: { children: ReactNode }) {
    return (
        <html lang="es" className={`${archivo.variable} ${mono.variable}`}>
            <head>
                {/* Antes de nada, para que no haya fogonazo blanco. */}
                <script dangerouslySetInnerHTML={{ __html: GUION_SIN_FOGONAZO }} />
            </head>
            <body>
                <Listo />
                {children}
            </body>
        </html>
    );
}
