"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * El menú del panel.
 *
 * Es de cliente por una sola razón: necesita saber en qué sección está
 * para marcarla, y `usePathname` es lo único que lo sabe sin que el
 * layout tenga que ir pasando la ruta a mano.
 *
 * ── Por qué está agrupado así ──────────────────────────────────────
 *
 * «Atender» es lo que tiene gente esperando del otro lado. «Saber» es lo
 * que se configura una vez cada tanto. «Configuración» es lo que casi
 * nunca se toca. Mezclarlos haría que lo urgente y lo administrativo se
 * lean igual, y en una pantalla que se abre cada mañana eso importa.
 *
 * ── Aquí no hay «En cola», y es a propósito ────────────────────────
 *
 * El panel del que viene esto tenía esa sección, porque allí los envíos
 * esperaban. Aquí el bot contesta solo y en segundos: para cuando el
 * cliente abre el panel ya está hecho, así que una bandeja de pendientes
 * estaría vacía casi siempre y le haría pensar que tiene trabajo.
 *
 * Lo que sí puede esperar —una respuesta apartada porque la cuenta llegó
 * al tope de llamadas de esa hora— se dice **en el propio comentario**,
 * que es donde se entiende, y no en una sección a la que habría que
 * entrar para descubrir que no pasa nada.
 *
 * ── Lo que todavía no existe no se disfraza de enlace ──────────────
 *
 * Las secciones sin pantalla se dibujan apagadas y **sin ser
 * pulsables**. Un enlace que no lleva a ningún sitio defrauda a quien lo
 * intenta, y hace dudar de si está roto el panel o su ratón. Prefiero
 * que se vea lo que viene y que se note que todavía no está.
 *
 * ── Pero ahora mismo ni se enseñan, y es por el App Review ─────────
 *
 * Meta pide grabaciones del panel para revisar la app. Un revisor que
 * ve **cinco entradas diciendo «pronto»** no lee «producto en camino»:
 * lee **producto a medias**, y eso es motivo de rechazo por sí solo.
 *
 * Así que hasta que existan no se dibujan. La lista de abajo **no se
 * toca** —sigue siendo el plan de lo que viene— y volver a enseñarlas es
 * poner esta constante en `true`. Decidido el 24/09/2026.
 */
const MOSTRAR_LO_QUE_VIENE = false;

type Hijo = { href: string; texto: string; pronto?: boolean };

const SECCIONES: { grupo: string; hijos: Hijo[] }[] = [
    {
        grupo: "Atender",
        hijos: [
            { href: "/panel", texto: "Inicio" },
            { href: "/panel/comentarios", texto: "Comentarios" },
            { href: "/panel/mensajes", texto: "Mensajes" },
        ],
    },
    {
        grupo: "Saber",
        hijos: [
            { href: "/panel/automatizaciones", texto: "Automatizaciones", pronto: true },
            { href: "/panel/publicaciones", texto: "Publicaciones", pronto: true },
        ],
    },
    {
        grupo: "Configuración",
        hijos: [
            { href: "/panel/configuracion", texto: "Apariencia" },
            { href: "/panel/configuracion/instagram", texto: "Tu Instagram", pronto: true },
            { href: "/panel/configuracion/cuenta", texto: "Tu cuenta", pronto: true },
        ],
    },
];

export default function Lateral({ negocio }: { negocio: string }) {
    const ruta = usePathname();

    // Un grupo cuyos hijos estén todos por venir desaparece entero: si no,
    // quedaría el título «Saber» solo, encabezando nada.
    const visibles = SECCIONES.map((s) => ({
        ...s,
        hijos: MOSTRAR_LO_QUE_VIENE ? s.hijos : s.hijos.filter((h) => !h.pronto),
    })).filter((s) => s.hijos.length > 0);

    return (
        <nav className="lateral" aria-label="Secciones del panel">
            <div className="lateral-marca">
                <span className="lateral-punto" aria-hidden="true" />
                <span className="lateral-nombres">
                    <b>ChatyChat</b>
                    <span>{negocio}</span>
                </span>
            </div>

            {visibles.map((s) => (
                <div key={s.grupo} className="lateral-grupo">
                    <p className="lateral-titulo">{s.grupo}</p>
                    {s.hijos.map((h) =>
                        h.pronto ? (
                            <span key={h.href} className="lateral-pronto">
                                {h.texto}
                                <em>pronto</em>
                            </span>
                        ) : (
                            <Link
                                key={h.href}
                                href={h.href}
                                className="lateral-enlace"
                                // El inicio sólo se marca en su ruta exacta; las
                                // demás, también en sus hijas. Sin esta
                                // distinción «Inicio» quedaría marcado siempre,
                                // porque toda ruta del panel empieza por él.
                                data-aqui={String(
                                    h.href === "/panel" ? ruta === h.href : ruta.startsWith(h.href),
                                )}
                            >
                                {h.texto}
                            </Link>
                        ),
                    )}
                </div>
            ))}
        </nav>
    );
}
