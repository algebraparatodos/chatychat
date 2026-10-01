import { PRODUCTO, TITULAR } from "@/lib/legal";

export const metadata = {
    title: "Aviso legal",
    description: "Quién presta el servicio ChatyChat y bajo qué condiciones.",
};

export default function AvisoLegal() {
    return (
        <>
            <h1>Aviso legal</h1>

            <h2>Quién presta este servicio</h2>

            <ul className="legal-fichas">
                <li>{TITULAR.razonSocial}</li>
                <li>NIF: {TITULAR.nif}</li>
                <li>{TITULAR.domicilio}</li>
                <li>Registro Mercantil: {TITULAR.registro}</li>
                <li>Nombre comercial: {TITULAR.marca}</li>
                <li>
                    <a href={`mailto:${TITULAR.correo}`}>{TITULAR.correo}</a> ·{" "}
                    <a href={TITULAR.web}>{TITULAR.web.replace("https://", "")}</a>
                </li>
            </ul>

            <p>
                {PRODUCTO.nombre} ({PRODUCTO.web.replace("https://", "")}) es un servicio de{" "}
                {TITULAR.razonSocial}.
            </p>

            <h2>Qué es este servicio</h2>

            <p>
                {PRODUCTO.nombre} contesta automáticamente los comentarios y los mensajes directos
                de la cuenta de Instagram de un negocio, según las reglas que ese negocio configura.
            </p>

            <p>
                Para funcionar necesita que el negocio autorice el acceso a su cuenta de Instagram.
                Esa autorización <strong>se puede retirar en cualquier momento</strong> desde los
                ajustes de Instagram, y al retirarla el servicio deja de poder contestar
                inmediatamente.
            </p>

            <h2>Lo que hace y lo que no</h2>

            <ul>
                <li>
                    <strong>Contesta a quien escribe primero.</strong> Nunca inicia una conversación
                    con alguien que no se ha dirigido al negocio.
                </li>
                <li>
                    <strong>Respeta los plazos que impone Instagram.</strong> Una respuesta privada
                    a un comentario sólo se puede mandar dentro de los 7 días siguientes, y un
                    mensaje al buzón sólo dentro de las 24 horas posteriores a que la persona
                    escriba.
                </li>
                <li>
                    <strong>No publica nada</strong> en nombre del negocio: ni fotos, ni vídeos, ni
                    historias.
                </li>
            </ul>

            <h2>Responsabilidad</h2>

            <p>
                Las respuestas que redacta el asistente son automáticas y pueden contener errores. El
                negocio es responsable de lo que se dice en su nombre, y por eso puede revisar en su
                panel todo lo que se ha contestado, cambiar los textos y apagar el asistente cuando
                quiera.
            </p>

            <p>
                {PRODUCTO.nombre} depende de la API de Instagram, que es de Meta. Una interrupción,
                un cambio de sus normas o una limitación por su parte pueden afectar al servicio, y
                eso queda fuera de nuestro control.
            </p>

            <p>
                Se pone cuidado en que todo funcione, pero no se garantiza que el servicio esté
                disponible sin interrupciones ni libre de errores.
            </p>

            <h2>Propiedad intelectual</h2>

            <p>
                El código, el diseño y los textos de {PRODUCTO.nombre} son propiedad de{" "}
                {TITULAR.razonSocial}. Lo que cada negocio escribe en su panel —sus automatizaciones,
                sus textos y su información— es suyo.
            </p>

            <h2>Legislación aplicable</h2>

            <p>
                Esta relación se rige por la legislación española. Para cualquier controversia, las
                partes se someten a los juzgados y tribunales del domicilio del titular, salvo que la
                normativa de consumo establezca otro fuero.
            </p>
        </>
    );
}
