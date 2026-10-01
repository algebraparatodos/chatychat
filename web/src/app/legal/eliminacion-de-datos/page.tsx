import { PRODUCTO, TITULAR } from "@/lib/legal";

export const metadata = {
    title: "Borrar tus datos",
    description: "Cómo pedir que se borren tus datos de ChatyChat.",
};

/**
 * Cómo se piden los datos de vuelta.
 *
 * ── Por qué está escrita para dos personas distintas ───────────────
 *
 * Aquí llegan dos clases de gente y no quieren lo mismo:
 *
 *   El **negocio** que contrató ChatyChat y quiere irse con todo lo suyo.
 *
 *   Alguien que **comentó o escribió** a ese negocio, que no nos conoce
 *   de nada, que probablemente llegó desde los ajustes de Instagram y
 *   que no tiene por qué saber qué es ChatyChat.
 *
 * Meta exige esta página para revisar la app, y quien la va a abrir
 * desde allí es el segundo. Por eso va primero.
 */
export default function EliminacionDeDatos() {
    return (
        <>
            <h1>Borrar tus datos</h1>

            <h2>Si comentaste o escribiste a un negocio</h2>

            <p className="legal-entrada">
                {PRODUCTO.nombre} es el asistente que contesta los comentarios y mensajes de
                Instagram de algunos negocios. Si escribiste a uno de ellos, guardamos tu
                comentario o tu mensaje, tu nombre de usuario de Instagram y lo que se te
                contestó.
            </p>

            <p>
                <strong>Para que lo borremos, escribí a{" "}
                <a href={`mailto:${TITULAR.correo}?subject=Borrar%20mis%20datos`}>
                    {TITULAR.correo}
                </a>{" "}
                diciendo a qué cuenta de Instagram le escribiste y desde qué usuario.</strong> Con
                eso basta: no hace falta que abras ninguna cuenta con nosotros ni que demuestres
                nada más.
            </p>

            <p>
                Se hace <strong>dentro de los 30 días</strong> y te avisamos cuando esté. Después no
                queda nada tuyo: ni el texto, ni tu usuario, ni el identificador.
            </p>

            <p>
                Si llegaste hasta aquí desde los ajustes de Instagram, al quitarnos el permiso desde
                allí te habremos dado <strong>un código de seguimiento</strong>. Con ese código
                podés consultar cómo va tu solicitud en{" "}
                <a href="https://webhook.example.com/datos/estado">
                    webhook.example.com/datos/estado
                </a>
                .
            </p>

            <h2>Si sos el negocio que contrató {PRODUCTO.nombre}</h2>

            <p>
                Darte de baja y borrar tus datos <strong>son dos cosas distintas</strong>, a
                propósito: que dejes de pagar no puede llevarse por delante tu historial sin que lo
                pidas.
            </p>

            <ul>
                <li>
                    <strong>Para dejar de usarlo</strong>, quitanos el permiso desde Instagram, en
                    Configuración → Aplicaciones y sitios web. El asistente deja de contestar en el
                    acto y nos enteramos en el momento.
                </li>
                <li>
                    <strong>Para borrarlo todo</strong>, escribinos a{" "}
                    <a href={`mailto:${TITULAR.correo}?subject=Borrar%20la%20cuenta`}>
                        {TITULAR.correo}
                    </a>
                    . Se borra tu cuenta, tus automatizaciones y todas las conversaciones que
                    guardamos de tu gente.
                </li>
            </ul>

            <h2>Quién responde de esto</h2>

            <ul className="legal-fichas">
                <li>{TITULAR.razonSocial}</li>
                <li>NIF: {TITULAR.nif}</li>
                <li>{TITULAR.domicilio}</li>
                <li>
                    <a href={`mailto:${TITULAR.correo}`}>{TITULAR.correo}</a>
                </li>
            </ul>
        </>
    );
}
