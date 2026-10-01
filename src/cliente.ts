import { DurableObject } from "cloudflare:workers";

import type { Env } from "./entorno";

import { atenderEntrada, type Entrada, type Quien } from "./atender";
import { PASOS, VERSION } from "./esquema-cliente";
import { barrer, proximoPendiente } from "./pendientes";

/**
 * Una cosa que llegó y lo que se hizo con ella.
 *
 * Sirve igual para un comentario y para un mensaje: son la misma tabla
 * y la misma pregunta —qué entró y qué se contestó—, y lo único que
 * cambia es dónde se ve. Por eso el tipo es uno solo.
 */
export type Atendido = {
    id: number;
    usuario: string | null;
    texto: string | null;
    media_id: string | null;
    respondido: number;
    automatizacion_id: number | null;
    respuesta: string | null;
    aviso_enviado: string | null;
    origen: string | null;
    error: string | null;
    creado: string;
};

/** Cuántos hay, cuántos se contestaron y cuántos fallaron. */
export type Cuentas = { total: number; respondidos: number; conFallo: number };

/**
 * Un negocio: su base, sus esperas y su importación.
 *
 * ── Por qué un objeto por cliente ──────────────────────────────────
 *
 * Porque **se crea nombrándolo**. `env.CLIENTES.idFromName("acmeshop")`
 * devuelve un objeto distinto por cliente sin declarar nada en ningún
 * sitio y sin desplegar. Eso es lo que hace que darse de alta sea
 * instantáneo: la persona rellena el formulario y su negocio existe.
 *
 * Con una base D1 por cliente no se podía. Un Worker no puede abrir una
 * base D1 arbitraria en ejecución —los enlaces se declaran en
 * `wrangler.jsonc` y se resuelven al desplegar—, así que cada alta
 * obligaba a un despliegue y a que hubiera alguien detrás. Está contado
 * en el README («Data isolation»): la decisión original ya dejaba
 * esta mudanza prevista para cuando eso empezara a doler.
 *
 * ── Las consultas son síncronas, y eso cambia cómo se escribe ──────
 *
 * `ctx.storage.sql.exec()` devuelve el resultado, no una promesa. No hay
 * `await` en una consulta y no hay carreras entre dos lecturas: mientras
 * corre un método, nadie más toca esta base. Es la diferencia más
 * visible con D1 y la que más simplifica el código de dentro.
 *
 * ── El aislamiento ya no lo vigila un guardián ─────────────────────
 *
 * Con D1 había un script que comprobaba que ningún módulo sacara una
 * base del entorno, porque una letra de más en un nombre de enlace leía
 * la base de otro cliente. Aquí eso **no se puede escribir**: este
 * objeto sólo alcanza su propio almacenamiento. El aislamiento dejó de
 * ser una regla que respetar y pasó a ser una propiedad de la
 * plataforma.
 */
export class Cliente extends DurableObject<Env> {
    private readonly sql: SqlStorage;

    /**
     * Lo ultimo que se supo de quien es este cliente.
     *
     * No se guarda en disco a proposito: es una copia de algo que vive en
     * la base de control y que cambia solo al renovarse el token.
     * Guardarlo aqui seria crear una segunda verdad, y el dia que las dos
     * discreparan el sintoma seria que los envios fallan por un token
     * caducado que alguien ya habia renovado.
     *
     * Vive lo que viva el objeto en memoria. Si no esta, la alarma no
     * manda y espera a la proxima.
     */
    private ultimoToken: Quien | null = null;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;

        // `blockConcurrencyWhile` retiene todo lo que llegue hasta que
        // esto termina. Sin él, el primer mensaje de un cliente nuevo
        // podría entrar a la vez que se crean las tablas y encontrarse la
        // mitad puestas.
        ctx.blockConcurrencyWhile(async () => this.prepararEsquema());
    }

    // ── El esquema ───────────────────────────────────────────────

    /**
     * Aplica los pasos que le falten a este cliente.
     *
     * Cada objeto lleva su cuenta, así que uno que lleve meses dormido se
     * pone al día solo la próxima vez que alguien le escriba. No hay
     * «migrar a todos los clientes», que es la operación que en una base
     * compartida da miedo y aquí no existe.
     */
    private prepararEsquema(): void {
        this.sql.exec(
            `CREATE TABLE IF NOT EXISTS esquema (
                paso   INTEGER PRIMARY KEY,
                nombre TEXT NOT NULL,
                cuando TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
        );

        const hechos = new Set(
            [...this.sql.exec<{ paso: number }>(`SELECT paso FROM esquema`)].map((f) => f.paso),
        );

        for (let i = 0; i < PASOS.length; i++) {
            if (hechos.has(i)) continue;
            this.sql.exec(PASOS[i].sql);
            this.sql.exec(`INSERT INTO esquema (paso, nombre) VALUES (?, ?)`, i, PASOS[i].nombre);
        }
    }

    /** Por qué versión va este cliente. Para diagnosticar sin adivinar. */
    versionDelEsquema(): { version: number; alDia: boolean } {
        const filas = [...this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM esquema`)];
        const version = filas[0]?.n ?? 0;
        return { version, alDia: version === VERSION };
    }

    // ── Lo que llega de Meta ─────────────────────────────────────

    /**
     * Atiende un aviso de Meta que ya se sabe que es de este cliente.
     *
     * El token llega por parametro y no guardado aqui: el Worker lo lee
     * de la base de control, que es donde manda.
     */
    async recibir(entrada: Entrada, quien: Quien): Promise<void> {
        this.ultimoToken = quien;
        try {
            await atenderEntrada(entrada, quien, this.sql);
        } finally {
            // Atender puede haber dejado algo programado para mas tarde
            // —una caja con espera, o una respuesta apartada por el tope
            // de la hora— asi que la alarma se recalcula siempre.
            await this.ajustarAlarma();
        }
    }

    // ── Las esperas, que ahora son alarmas ───────────────────────

    /**
     * Deja algo apuntado para más tarde y pone la alarma.
     *
     * ── Por qué esto ya no lo barre un cron ────────────────────────
     *
     * Antes había un cron cada cinco minutos que recorría **todos** los
     * clientes preguntando si alguno tenía algo pendiente. Con diez
     * clientes era un desperdicio pequeño; con mil es doce mil consultas
     * por hora para, casi siempre, no encontrar nada.
     *
     * Un objeto se despierta **él solo** a la hora exacta y sólo si
     * tiene algo. Un cliente sin esperas no cuesta nada, y una espera de
     * 23 horas llega a su hora y no cinco minutos tarde.
     */
    async programar(p: {
        destino: string;
        cuando: Date;
        texto?: string | null;
        nodoId?: number | null;
        tipo?: string;
        comentarioId?: string | null;
    }): Promise<void> {
        this.sql.exec(
            `INSERT INTO pendientes (destino, nodo_id, texto, tipo, comentario_id, cuando)
             VALUES (?, ?, ?, ?, ?, ?)`,
            p.destino,
            p.nodoId ?? null,
            p.texto ?? null,
            p.tipo ?? "mensaje",
            p.comentarioId ?? null,
            p.cuando.toISOString(),
        );
        await this.ajustarAlarma();
    }

    /**
     * Pone la alarma a la hora del primer pendiente.
     *
     * Hay **una sola alarma por objeto**: pedir otra pisa la anterior.
     * Por eso siempre se calcula cuál es la más próxima de todo lo que
     * hay —esperas e importación— en vez de programarla al vuelo.
     */
    private async ajustarAlarma(): Promise<void> {
        const proxima = this.proximaHora();
        const puesta = await this.ctx.storage.getAlarm();

        if (proxima === null) {
            if (puesta !== null) await this.ctx.storage.deleteAlarm();
            return;
        }
        // Se reprograma sólo si cambia de verdad. Escribir la misma alarma
        // una y otra vez es trabajo que no hace nada.
        if (puesta === null || Math.abs(puesta - proxima) > 1000) {
            await this.ctx.storage.setAlarm(proxima);
        }
    }

    /** Cuándo hay que despertarse, o `null` si no hace falta. */
    private proximaHora(): number | null {
        const horas: number[] = [];

        const espera = proximoPendiente(this.sql);
        if (espera !== null) horas.push(espera);

        // La importación se trocea para no comerse ni el tiempo de CPU ni
        // el límite de llamadas por hora de Meta. Entre tanda y tanda se
        // espera un poco, y ese poco también es una alarma.
        const importando = [
            ...this.sql.exec<{ estado: string }>(`SELECT estado FROM importacion WHERE id = 1`),
        ][0];
        if (importando && (importando.estado === "publicaciones" || importando.estado === "comentarios")) {
            horas.push(Date.now() + ESPERA_ENTRE_TANDAS);
        }

        const validas = horas.filter((h) => Number.isFinite(h));
        return validas.length ? Math.min(...validas) : null;
    }

    /**
     * La alarma.
     *
     * Atiende lo que toque y **vuelve a programarse**. Si algo revienta
     * aquí, Cloudflare reintenta con espera creciente, así que lo que no
     * hay que hacer es tragarse el error en silencio: un fallo que no
     * lanza es una alarma que no se reintenta.
     */
    async alarm(): Promise<void> {
        try {
            await this.atenderPendientes();
            await this.seguirImportacion();
        } finally {
            await this.ajustarAlarma();
        }
    }

    /**
     * Manda lo que ya tocaba.
     *
     * Si el objeto se despierta sin saber el token —porque lo reciclaron
     * y todavia no le ha llegado ningun aviso— no manda nada y espera.
     * Es preferible a mandar con un token que podria estar viejo.
     */
    private async atenderPendientes(): Promise<void> {
        if (!this.ultimoToken) {
            console.warn('[cliente] alarma sin token a mano, se espera a la proxima');
            return;
        }
        const { clave, cred } = this.ultimoToken;
        const r = await barrer(this.sql, cred, clave);
        if (r.enviados || r.fallos || r.caducados) {
            console.log(
                `[${clave}] pendientes: ${r.enviados} enviados, ` +
                    `${r.caducados} caducados, ${r.fallos} fallos`,
            );
        }
    }

    /** El importador del historial. Llega en el paso siguiente. */
    private async seguirImportacion(): Promise<void> {}

    // ── Lo que mira el panel ─────────────────────────────────────

    /**
     * Cómo va la importación, para la franja de progreso.
     *
     * Devuelve el total de verdad, no un porcentaje inventado: sale de
     * sumar el `comments_count` que Meta da en cada publicación.
     */
    progresoDeImportacion(): {
        estado: string;
        total: number;
        traidos: number;
        error: string | null;
    } | null {
        const f = [
            ...this.sql.exec<{ estado: string; total: number; traidos: number; error: string | null }>(
                `SELECT estado, total, traidos, error FROM importacion WHERE id = 1`,
            ),
        ][0];
        return f ?? null;
    }

    /**
     * Llena un objeto vacío con los datos que venían de su base D1.
     *
     * ── Por qué sólo sobre un objeto vacío ─────────────────────────
     *
     * Porque esto se corre una vez por cliente y **no hay forma de
     * deshacerlo**. Si se pudiera sembrar encima, correr dos veces el
     * mismo volcado duplicaría cada evento y cada automatización, y el
     * síntoma sería que el bot contesta dos veces a todo.
     *
     * La comprobación mira si hay algún evento o alguna automatización.
     * Las tablas vacías que crea el esquema no cuentan: un objeto recién
     * creado ya tiene tablas, lo que no tiene es contenido.
     *
     * ── Y por qué acepta las tablas por nombre ─────────────────────
     *
     * Para no tener que escribir aquí el volcado de cada tabla a mano y
     * que se quede desactualizado en cuanto el esquema crezca. A cambio,
     * **sólo se admiten las tablas que este objeto conoce**: un nombre
     * que no esté en la lista se rechaza entero, porque el nombre de una
     * tabla no se puede parametrizar en SQL y lo que no se parametriza
     * hay que comprobarlo.
     */
    async sembrar(
        datos: Record<string, Record<string, unknown>[]>,
        opciones: { vaciar?: boolean } = {},
    ): Promise<{ puestas: Record<string, number>; error?: string }> {
        const conocidas0 = new Set(
            [...this.sql.exec<{ name: string }>(
                `SELECT name FROM sqlite_master WHERE type='table'`,
            )].map((f) => f.name),
        )

        if (opciones.vaciar) {
            // ⚠️ Esto borra todo lo del cliente y no se deshace.
            //
            // Existe para dos cosas concretas: volver a migrar a alguien
            // cuando la primera vez salio mal, y reiniciar al cliente de
            // pruebas entre pasadas de la bateria. **Va siempre pedido a
            // mano**, nunca por defecto, porque la diferencia entre
            // sembrar y sembrar-vaciando es la diferencia entre no hacer
            // nada y perderlo todo.
            console.warn('[cliente] se vacia el objeto antes de sembrar');
            for (const tabla of ORDEN_DE_BORRADO) {
                if (!conocidas0.has(tabla)) continue
                this.sql.exec(`DELETE FROM ${tabla}`)
            }
            // Y cualquier tabla que exista y no este en la lista, que no
            // tendra claves ajenas porque las que las tienen si estan.
            for (const tabla of conocidas0) {
                if (ORDEN_DE_BORRADO.includes(tabla)) continue
                if (tabla === 'esquema' || tabla.startsWith('sqlite_') || tabla.startsWith('_cf')) continue
                this.sql.exec(`DELETE FROM ${tabla}`)
            }
        } else {
            const yaHay =
                [...this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM eventos`)][0]?.n ||
                [...this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM automatizaciones`)][0]?.n

            if (yaHay) {
                return {
                    puestas: {},
                    error: 'este cliente ya tiene datos: sembrar solo va sobre uno vacio, o con vaciar',
                }
            }
        }

        const conocidas = new Set(
            [...this.sql.exec<{ name: string }>(
                `SELECT name FROM sqlite_master WHERE type='table'`,
            )].map((f) => f.name),
        )

        const puestas: Record<string, number> = {}
        for (const [tabla, filas] of Object.entries(datos)) {
            if (!conocidas.has(tabla) || tabla === 'esquema' || tabla.startsWith('sqlite_')) {
                return { puestas, error: `la tabla «${tabla}» no existe aqui o no se puede sembrar` }
            }
            for (const fila of filas) {
                const columnas = Object.keys(fila)
                if (!columnas.length) continue
                this.sql.exec(
                    `INSERT OR REPLACE INTO ${tabla} (${columnas.join(', ')})
                     VALUES (${columnas.map(() => '?').join(', ')})`,
                    ...columnas.map((c) => fila[c] as never),
                )
            }
            puestas[tabla] = filas.length
        }

        // Sembrar puede haber traido pendientes con su hora, asi que hay
        // que despertarse cuando toque.
        await this.ajustarAlarma()
        return { puestas }
    }

    // ── Lo que lee el panel ──────────────────────────────────────

    /**
     * Los comentarios que llegaron, con lo que el bot contestó.
     *
     * ── Por qué un método y no una consulta suelta ─────────────────
     *
     * Porque el panel es otro Worker, y si le dejara mandar SQL, la
     * forma de las tablas pasaría a ser parte del contrato entre los
     * dos: cambiar una columna aquí rompería una pantalla allá, sin que
     * nada avisara hasta que alguien la abriera.
     *
     * Con un método, lo que viaja es una lista de comentarios con los
     * campos que esa pantalla necesita, y por dentro se puede cambiar lo
     * que haga falta.
     *
     * ── No hay «cola», y es a propósito ────────────────────────────
     *
     * Esto es un registro de lo que pasó, no una bandeja de trabajo. El
     * bot contesta solo, en segundos; para cuando el cliente abre el
     * panel ya está hecho. Lo que necesita es **leer lo que se dijo en
     * su nombre**, no aprobar nada.
     */
    comentarios(limite = 50, desde = 0): Atendido[] {
        return this.atendidos('comentario', limite, desde)
    }

    /**
     * Lo mismo, pero del buzón.
     *
     * ── Por qué comparte el cuerpo con los comentarios ─────────────
     *
     * Porque **es la misma tabla y la misma pregunta**: qué llegó y qué
     * se contestó. Lo único que cambia es el `tipo`. Dos copias del
     * mismo SELECT serían dos sitios donde arreglar la próxima columna
     * que se añada, y el segundo se olvida siempre.
     *
     * Lo que **no** comparten es la pantalla, porque un comentario es
     * público y un mensaje no, y eso cambia lo que hay que enseñar: un
     * comentario lleva además el aviso que se dejó a la vista de todos.
     */
    mensajes(limite = 50, desde = 0): Atendido[] {
        return this.atendidos('mensaje', limite, desde)
    }

    private atendidos(tipo: string, limite: number, desde: number): Atendido[] {
        return [
            ...this.sql.exec<Atendido>(
                `SELECT id, usuario, texto, media_id, respondido, automatizacion_id,
                        respuesta, aviso_enviado, origen, error, creado
                   FROM eventos
                  WHERE tipo = ?1 AND archivado = 0
                  ORDER BY id DESC
                  LIMIT ?2 OFFSET ?3`,
                tipo,
                Math.min(limite, 200),
                Math.max(desde, 0),
            ),
        ]
    }

    /**
     * Las automatizaciones con sus disparadores, para el panel.
     *
     * Se devuelven juntas y no en dos llamadas porque **no se entienden
     * por separado**: una automatización sin saber qué la dispara no
     * dice nada, y en la pantalla van siempre en la misma fila.
     */
    automatizaciones(): {
        id: number
        nombre: string
        activa: number
        respuesta: string
        aviso_publico: string | null
        disparos: number
        disparadores: { id: number; tipo: string; palabras: string; objetivo: string | null; activo: number }[]
    }[] {
        const autos = [
            ...this.sql.exec<{
                id: number
                nombre: string
                activa: number
                respuesta: string
                aviso_publico: string | null
                disparos: number
            }>(
                `SELECT id, nombre, activa, respuesta, aviso_publico, disparos
                   FROM automatizaciones
                  WHERE archivada = 0
                  ORDER BY orden ASC, id ASC`,
            ),
        ]

        const disparadores = [
            ...this.sql.exec<{
                id: number
                automatizacion_id: number
                tipo: string
                palabras: string
                objetivo: string | null
                activo: number
            }>(
                `SELECT id, automatizacion_id, tipo, palabras, objetivo, activo
                   FROM disparadores ORDER BY id ASC`,
            ),
        ]

        return autos.map((a) => ({
            ...a,
            disparadores: disparadores
                .filter((d) => d.automatizacion_id === a.id)
                .map(({ automatizacion_id: _, ...resto }) => resto),
        }))
    }

    /**
     * Cambia el texto de una automatización.
     *
     * ── Lo que NO deja cambiar, y por qué ──────────────────────────
     *
     * Ni el identificador, ni de qué cliente es, ni los contadores. El
     * panel sólo toca lo que el dueño del negocio decide: qué se
     * contesta, qué se dice en público, con qué palabras se dispara y si
     * está encendida.
     *
     * Los contadores no se tocan porque son un registro de lo que pasó:
     * dejarlos editables convertiría en opinable algo que es un hecho.
     *
     * ── El texto vacío no se acepta ────────────────────────────────
     *
     * Una automatización encendida con la respuesta en blanco no falla:
     * manda un mensaje vacío, o peor, Meta lo rechaza y la persona que
     * preguntó se queda sin nada. Se corta aquí, que es donde se puede
     * avisar.
     */
    guardarAutomatizacion(a: {
        id: number
        nombre?: string
        activa?: boolean
        respuesta?: string
        avisoPublico?: string | null
    }): { ok: boolean; error?: string } {
        const existe = [
            ...this.sql.exec<{ id: number }>(`SELECT id FROM automatizaciones WHERE id = ?`, a.id),
        ][0]
        if (!existe) return { ok: false, error: 'esa automatizacion no existe' }

        if (a.respuesta !== undefined && !a.respuesta.trim()) {
            return { ok: false, error: 'la respuesta no puede estar vacia' }
        }
        if (a.nombre !== undefined && !a.nombre.trim()) {
            return { ok: false, error: 'el nombre no puede estar vacio' }
        }

        try {
            this.sql.exec(
                `UPDATE automatizaciones
                    SET nombre        = COALESCE(?2, nombre),
                        activa        = COALESCE(?3, activa),
                        respuesta     = COALESCE(?4, respuesta),
                        aviso_publico = CASE WHEN ?6 = 1 THEN ?5 ELSE aviso_publico END,
                        actualizada   = datetime('now')
                  WHERE id = ?1`,
                a.id,
                a.nombre?.trim() ?? null,
                a.activa === undefined ? null : a.activa ? 1 : 0,
                a.respuesta?.trim() ?? null,
                a.avisoPublico?.trim() || null,
                // El aviso publico si se puede dejar vacio a proposito —es
                // opcional— asi que hace falta distinguir «no lo mandes»
                // de «mandalo vacio». Con COALESCE solo no se puede.
                a.avisoPublico === undefined ? 0 : 1,
            )
            return { ok: true }
        } catch (err) {
            console.error(`[cliente] no se pudo guardar la automatizacion ${a.id}: ${err}`)
            return { ok: false, error: 'no se pudo guardar' }
        }
    }

    /** Cambia las palabras que disparan, o lo enciende y apaga. */
    guardarDisparador(d: {
        id: number
        palabras?: string
        activo?: boolean
    }): { ok: boolean; error?: string } {
        const existe = [
            ...this.sql.exec<{ id: number }>(`SELECT id FROM disparadores WHERE id = ?`, d.id),
        ][0]
        if (!existe) return { ok: false, error: 'ese disparador no existe' }

        // ⚠️ Palabras vacias quiere decir «cualquier cosa», y con un
        // objetivo vacio tambien es una bomba: contestaria a TODOS los
        // comentarios de la cuenta. Se puede querer —en una historia
        // tiene sentido— pero no por accidente, asi que desde el panel se
        // avisa en vez de dejarlo pasar en silencio.
        const limpio = d.palabras?.trim()
        if (d.palabras !== undefined && !limpio) {
            return {
                ok: false,
                error: 'sin palabras contestaria a todos los comentarios: pone al menos una',
            }
        }

        try {
            this.sql.exec(
                `UPDATE disparadores
                    SET palabras = COALESCE(?2, palabras),
                        activo   = COALESCE(?3, activo)
                  WHERE id = ?1`,
                d.id,
                limpio ?? null,
                d.activo === undefined ? null : d.activo ? 1 : 0,
            )
            return { ok: true }
        } catch (err) {
            console.error(`[cliente] no se pudo guardar el disparador ${d.id}: ${err}`)
            return { ok: false, error: 'no se pudo guardar' }
        }
    }

    /** Cuántos comentarios hay, para paginar sin adivinar. */
    cuantosComentarios(): Cuentas {
        return this.cuantosDe('comentario')
    }

    cuantosMensajes(): Cuentas {
        return this.cuantosDe('mensaje')
    }

    private cuantosDe(tipo: string): Cuentas {
        const f = [
            ...this.sql.exec<Cuentas>(
                `SELECT COUNT(*) AS total,
                        SUM(CASE WHEN respondido = 1 THEN 1 ELSE 0 END) AS respondidos,
                        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS conFallo
                   FROM eventos
                  WHERE tipo = ?1 AND archivado = 0`,
                tipo,
            ),
        ][0]
        return {
            total: f?.total ?? 0,
            respondidos: f?.respondidos ?? 0,
            conFallo: f?.conFallo ?? 0,
        }
    }

    /** Un resumen de lo que hay dentro, para comprobar una migración. */
    estado(): Record<string, number | string | boolean> {
        const cuantos = (tabla: string) =>
            [...this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabla}`)][0]?.n ?? 0

        const { version, alDia } = this.versionDelEsquema()
        return {
            version,
            alDia,
            automatizaciones: cuantos('automatizaciones'),
            disparadores: cuantos('disparadores'),
            nodos: cuantos('nodos'),
            botones: cuantos('botones'),
            eventos: cuantos('eventos'),
            contactos: cuantos('contactos'),
            pendientes: cuantos('pendientes'),
            publicaciones: cuantos('publicaciones'),
            historias: cuantos('historias'),
            bytes: this.sql.databaseSize,
        }
    }

    /**
     * Una consulta de sólo lectura, para diagnosticar.
     *
     * ── Por qué esto existe, y por qué sólo lee ────────────────────
     *
     * Con D1 se podía abrir una consola y mirar la base de un cliente con
     * `wrangler d1 execute`. Eso era lo mejor que tenía D1 y es lo único
     * que se pierde al mudarse: el almacenamiento de un Durable Object no
     * se alcanza desde fuera.
     *
     * Así que se devuelve por aquí, con dos límites que no se negocian:
     * **sólo `SELECT`** y con tope de filas. Quien llama a esto ya pasó
     * el control de quién es; esto es la última puerta, no la primera.
     */
    consultar(sql: string, limite = 200): { filas: FilaSuelta[]; error?: string } {
        const limpio = sql.trim().replace(/;+\s*$/, "");
        if (!/^select\s/i.test(limpio) || /;/.test(limpio)) {
            return { filas: [], error: "Aqui solo se puede SELECT, y una sola sentencia." };
        }
        try {
            // El tope se pone **envolviendo**, no pegando un LIMIT al
            // final. Pegarlo revienta en cuanto la consulta ya trae el
            // suyo: `... LIMIT 1 LIMIT 200` es un error de sintaxis, y
            // el mensaje que da SQLite —«near LIMIT»— no dice de donde
            // sale el segundo. Costo una prueba roja el 23/09/2026.
            //
            // Envolviendo, el tope se aplica siempre y nunca choca con
            // lo que haya escrito quien consulta.
            return {
                filas: [
                    ...this.sql.exec(
                        `SELECT * FROM (${limpio}) LIMIT ${Math.min(limite, 1000)}`,
                    ),
                ] as FilaSuelta[],
            };
        } catch (err) {
            return { filas: [], error: String(err) };
        }
    }
}

/**
 * En qué orden se vacían las tablas.
 *
 * ⚠️ **De hijas a madres, y no es cosmético.**
 *
 * `botones` apunta a `nodos`, `pendientes` tambien, y `nodos`,
 * `disparadores` y `eventos` apuntan a `automatizaciones`. Borrar la
 * madre primero deja filas huerfanas, y SQLite lo rechaza al cerrar con
 * «FOREIGN KEY constraint failed».
 *
 * Se descubrio el 23/09/2026 en la bateria: vaciar recorriendo las
 * tablas en el orden en que salian fallaba una de cada dos veces, segun
 * el orden en que SQLite las devolviera. Un fallo asi, intermitente y
 * dependiente de algo que uno no controla, es de los peores de
 * diagnosticar, y por eso el orden va escrito aqui en vez de dejarse al
 * azar.
 */
const ORDEN_DE_BORRADO = [
    'botones',
    'pendientes',
    'nodos',
    'disparadores',
    'eventos',
    'automatizaciones',
]

/**
 * Una fila cualquiera, como sale de SQLite.
 *
 * Los valores se declaran uno por uno y no como `unknown` porque esto
 * **viaja por RPC**: Cloudflare sólo deja devolver cosas que sepa
 * serializar, y con `unknown` el tipo del otro lado acaba siendo `never`
 * y no compila nada. Son los cuatro tipos que SQLite puede dar.
 */
export type FilaSuelta = Record<string, string | number | ArrayBuffer | null>

/**
 * Cuánto se espera entre tandas de importación.
 *
 * Treinta segundos. No es por el tiempo de CPU —una tanda son unas pocas
 * llamadas— sino por no comerse el límite de peticiones por hora de la
 * cuenta del cliente, que es suyo y que el bot necesita para contestar a
 * la gente que escribe **ahora**. Traer el historial nunca puede dejar
 * sin contestar a alguien que está esperando.
 */
const ESPERA_ENTRE_TANDAS = 30_000;
