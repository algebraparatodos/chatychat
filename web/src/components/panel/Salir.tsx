import { salir } from "@/app/acciones";

/**
 * Salir.
 *
 * Es un formulario y no un enlace a propósito: cerrar la sesión cambia
 * algo, y lo que cambia algo va por POST. Un enlace lo pueden disparar
 * el navegador precargando o cualquier cosa que siga enlaces sola, y
 * echar a alguien de su panel sin que lo haya pedido es de los fallos
 * más molestos que existen.
 */
export default function Salir() {
    return (
        <form action={salir}>
            <button type="submit" className="salir">
                Salir
            </button>
        </form>
    );
}
