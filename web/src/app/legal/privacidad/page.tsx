import { ENCARGADOS, PLAZOS, PRODUCTO, TITULAR } from "@/lib/legal";

export const metadata = {
    title: "Privacidad",
    description: "Qué datos trata ChatyChat, por cuenta de quién y con quién se comparten.",
};

/**
 * La política de privacidad de ChatyChat.
 *
 * ⚠️ **Ésta es la URL que declara la app de Meta.** El revisor la abre.
 *
 * Está escrita para que la entienda el dueño de un negocio pequeño, no
 * para que aguante una demanda. Eso no es descuido: una política que
 * nadie lee no protege a nadie, y la gente que la va a leer aquí son
 * ceramistas y peluqueros decidiendo si nos dejan hablar con sus
 * clientas.
 *
 * Lo que sí es innegociable es que **no diga nada falso**. Cada
 * proveedor que toque datos aparece, y lo que se le manda a cada uno
 * está escrito. Si mañana se añade otro al producto y no se añade aquí,
 * esta página pasa a ser una declaración falsa.
 */
export default function Privacidad() {
    return (
        <>
            <h1>Privacidad</h1>

            <p className="legal-entrada">
                {PRODUCTO.nombre} contesta por vos los comentarios y mensajes de Instagram de tu
                negocio. Para eso lee lo que te escribe tu gente. Esta página cuenta qué se guarda,
                durante cuánto, y quién más lo ve.
            </p>

            <h2>Quién es responsable de qué</h2>

            <p>
                Esto es lo primero porque es lo que más se confunde, y determina lo demás.
            </p>

            <ul>
                <li>
                    <strong>Vos, el negocio, sos el responsable</strong> de los datos de tu gente.
                    Son tus clientes, tu cuenta de Instagram y tus conversaciones. Vos decidís qué
                    se contesta y podés borrarlo cuando quieras.
                </li>
                <li>
                    <strong>{TITULAR.razonSocial} es el encargado del tratamiento.</strong> Tratamos
                    esos datos por cuenta tuya y siguiendo tus instrucciones. No son nuestros y no
                    los usamos para nada que no sea prestarte el servicio.
                </li>
            </ul>

            <p>
                En concreto: <strong>no vendemos datos, no los cedemos a nadie con fines
                comerciales, y no los usamos para entrenar ningún modelo</strong> ni para publicidad.
            </p>

            <h2>Qué se guarda</h2>

            <ul>
                <li>
                    <strong>Los comentarios y mensajes</strong> que te escriben: el texto, el nombre
                    de usuario de Instagram de quien lo escribió y su identificador, y en qué
                    publicación fue.
                </li>
                <li>
                    <strong>Lo que el asistente contestó</strong> en tu nombre, para que puedas
                    leerlo.
                </li>
                <li>
                    <strong>Los datos básicos de tus publicaciones</strong>: el identificador, el
                    enlace, la miniatura y el pie. Sirven para que elijas en qué publicación actúa
                    cada automatización y para reconocerlas de un vistazo.{" "}
                    <strong>No descargamos ni republicamos tus fotos ni tus vídeos.</strong>
                </li>
                <li>
                    <strong>De vos:</strong> tu correo, la contraseña —de la que sólo guardamos un
                    resto del que no se puede volver atrás— y el permiso que nos diste en Instagram.
                </li>
            </ul>

            <h2>Con quién se comparten</h2>

            <p>
                Con estos tres, y con nadie más. Cada uno actúa como encargado del tratamiento:
            </p>

            <dl className="legal-lista">
                {ENCARGADOS.map((e) => (
                    <div key={e.nombre}>
                        <dt>
                            {e.nombre} <span>— {e.para}</span>
                        </dt>
                        <dd>
                            {e.donde}{" "}
                            <a href={e.web} target="_blank" rel="noreferrer">
                                Su política
                            </a>
                            .
                        </dd>
                    </div>
                ))}
            </dl>

            <p className="legal-ojo">
                Sobre la inteligencia artificial, para que quede claro: al redactar una respuesta se
                le envía a OpenAI <strong>el texto del comentario o mensaje</strong> y la información
                que vos hayas cargado sobre tu negocio.{" "}
                <strong>No se le envían los nombres de usuario ni los identificadores</strong> de las
                personas que escriben, y lo que se le manda{" "}
                <strong>no se usa para entrenar sus modelos</strong>.
            </p>

            <h2>Cuánto tiempo</h2>

            <dl className="legal-lista">
                {PLAZOS.map((p) => (
                    <div key={p.que}>
                        <dt>{p.que}</dt>
                        <dd>{p.cuanto}</dd>
                    </div>
                ))}
            </dl>

            <h2>Tus derechos, y los de tu gente</h2>

            <p>
                Cualquiera puede pedir acceder a sus datos, corregirlos, borrarlos, limitar su uso,
                oponerse al tratamiento o llevárselos. Se pide escribiendo a{" "}
                <a href={`mailto:${TITULAR.correo}`}>{TITULAR.correo}</a> y se contesta dentro de un
                mes.
            </p>

            <p>
                Si alguien que te escribió por Instagram quiere que borremos lo suyo, puede hacerlo
                directamente desde <a href="/legal/eliminacion-de-datos">esta página</a>, sin pasar
                por vos.
            </p>

            <p>
                Y si crees que no lo hemos hecho bien, podés reclamar ante la{" "}
                <a href="https://www.aepd.es" target="_blank" rel="noreferrer">
                    Agencia Española de Protección de Datos
                </a>
                .
            </p>

            <h2>Quién trata tus datos</h2>

            <ul className="legal-fichas">
                <li>{TITULAR.razonSocial}</li>
                <li>NIF: {TITULAR.nif}</li>
                <li>{TITULAR.domicilio}</li>
                <li>Registro Mercantil: {TITULAR.registro}</li>
                <li>
                    <a href={`mailto:${TITULAR.correo}`}>{TITULAR.correo}</a>
                </li>
            </ul>

            <p className="legal-flojo">
                {PRODUCTO.nombre} es un servicio de {TITULAR.razonSocial}, que opera bajo la marca{" "}
                {TITULAR.marca}.
            </p>
        </>
    );
}
