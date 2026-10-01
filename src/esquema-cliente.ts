/**
 * El esquema de un cliente, dentro de su Durable Object.
 *
 * ── Por qué está en TypeScript y no en un `.sql` ───────────────────
 *
 * Porque un Durable Object crea su base **la primera vez que alguien le
 * habla**, dentro del propio Worker. No hay un momento de «desplegar la
 * base» en el que se pueda aplicar un archivo desde fuera: el archivo
 * tiene que viajar con el código.
 *
 * Es además lo que hace que dar de alta a un cliente sea instantáneo. No
 * hay nada que crear ni que desplegar: se le nombra, y al primer mensaje
 * su base existe con estas tablas dentro.
 *
 * ── Cómo crece esto ────────────────────────────────────────────────
 *
 * Cada cambio es **un paso nuevo al final de `PASOS`, y no se toca
 * ninguno de los anteriores**. La tabla `esquema` guarda por dónde va
 * cada cliente, y al abrirse aplica los que le falten. Editar un paso
 * viejo no arregla a los clientes que ya lo aplicaron: sólo desordena a
 * los nuevos.
 */

/**
 * Los pasos, en orden y para siempre.
 *
 * El primero crea todo lo que existía en la época de D1, tal cual, para
 * que los clientes que se migran encuentren su casa igual que la
 * dejaron.
 */
export const PASOS: { nombre: string; sql: string }[] = [
    {
        nombre: "el esquema de siempre",
        sql: `
CREATE TABLE IF NOT EXISTS automatizaciones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre           TEXT    NOT NULL,
    activa           INTEGER NOT NULL DEFAULT 0,
    archivada        INTEGER NOT NULL DEFAULT 0,
    orden            INTEGER NOT NULL DEFAULT 0,
    respuesta        TEXT    NOT NULL DEFAULT '',
    aviso_publico    TEXT,
    prioridad        INTEGER NOT NULL DEFAULT 0,
    verificado       INTEGER NOT NULL DEFAULT 0,
    disparos         INTEGER NOT NULL DEFAULT 0,
    disparos_previos INTEGER NOT NULL DEFAULT 0,
    origen           TEXT,
    notas            TEXT,
    creada           TEXT    NOT NULL DEFAULT (datetime('now')),
    actualizada      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS automatizaciones_en_uso ON automatizaciones (archivada, orden);

CREATE TABLE IF NOT EXISTS disparadores (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    automatizacion_id INTEGER NOT NULL REFERENCES automatizaciones(id),
    tipo              TEXT    NOT NULL DEFAULT 'comentario',
    objetivo          TEXT,
    palabras          TEXT    NOT NULL DEFAULT '',
    activo            INTEGER NOT NULL DEFAULT 1,
    disparos          INTEGER NOT NULL DEFAULT 0,
    disparos_previos  INTEGER NOT NULL DEFAULT 0,
    nota              TEXT
);
CREATE INDEX IF NOT EXISTS disparadores_vivos ON disparadores (tipo, activo, objetivo);

CREATE TABLE IF NOT EXISTS nodos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    automatizacion_id INTEGER NOT NULL REFERENCES automatizaciones(id),
    tipo              TEXT    NOT NULL DEFAULT 'mensaje',
    texto             TEXT,
    orden             INTEGER NOT NULL DEFAULT 0,
    siguiente         INTEGER REFERENCES nodos(id),
    x                 INTEGER NOT NULL DEFAULT 0,
    y                 INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS nodos_por_flujo ON nodos (automatizacion_id, orden);

CREATE TABLE IF NOT EXISTS botones (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nodo_id INTEGER NOT NULL REFERENCES nodos(id),
    texto   TEXT    NOT NULL,
    tipo    TEXT    NOT NULL DEFAULT 'ir',
    destino INTEGER REFERENCES nodos(id),
    url     TEXT,
    orden   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS botones_por_nodo ON botones (nodo_id, orden);

CREATE TABLE IF NOT EXISTS eventos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo              TEXT    NOT NULL,
    de                TEXT    NOT NULL,
    usuario           TEXT,
    texto             TEXT,
    comentario_id     TEXT,
    media_id          TEXT,
    canal             TEXT,
    automatizacion_id INTEGER REFERENCES automatizaciones(id),
    respondido        INTEGER NOT NULL DEFAULT 0,
    archivado         INTEGER NOT NULL DEFAULT 0,
    error             TEXT,
    creado            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS eventos_comentario_unico
    ON eventos (comentario_id) WHERE comentario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS eventos_lista       ON eventos (tipo, archivado, id DESC);
CREATE INDEX IF NOT EXISTS eventos_por_persona ON eventos (de);
CREATE INDEX IF NOT EXISTS eventos_por_media   ON eventos (media_id) WHERE media_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS contactos (
    de          TEXT PRIMARY KEY,
    usuario     TEXT,
    veces       INTEGER NOT NULL DEFAULT 1,
    primera_vez TEXT    NOT NULL DEFAULT (datetime('now')),
    ultima_vez  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pendientes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    destino       TEXT    NOT NULL,
    nodo_id       INTEGER REFERENCES nodos(id),
    texto         TEXT,
    tipo          TEXT    NOT NULL DEFAULT 'mensaje',
    comentario_id TEXT,
    cuando        TEXT    NOT NULL,
    estado        TEXT    NOT NULL DEFAULT 'espera',
    intentos      INTEGER NOT NULL DEFAULT 0,
    error         TEXT,
    creado        TEXT    NOT NULL DEFAULT (datetime('now')),
    terminado     TEXT
);
CREATE INDEX IF NOT EXISTS pendientes_a_tiempo ON pendientes (estado, cuando);

CREATE TABLE IF NOT EXISTS ritmo (
    hora     TEXT PRIMARY KEY,
    llamadas INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS publicaciones (
    id         TEXT PRIMARY KEY,
    permalink  TEXT,
    miniatura  TEXT,
    tipo       TEXT,
    leyenda    TEXT,
    creada     TEXT,
    fijada     INTEGER NOT NULL DEFAULT 0,
    refrescada TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS historias (
    id        TEXT PRIMARY KEY,
    permalink TEXT,
    miniatura TEXT,
    tipo      TEXT,
    creada    TEXT,
    vista     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS historias_por_fecha ON historias (creada DESC);

CREATE TABLE IF NOT EXISTS perfil (
    id            TEXT PRIMARY KEY,
    usuario       TEXT,
    nombre        TEXT,
    bio           TEXT,
    foto          TEXT,
    seguidores    INTEGER,
    publicaciones INTEGER,
    refrescado    TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
    },

    {
        nombre: "la importacion del historial",
        sql: `
/*
 * Traer TODO el historial de comentarios, por tandas.
 *
 * Hace falta una tabla y no una variable porque esto **dura mas que una
 * peticion**: una cuenta con diez mil comentarios son cientos de
 * llamadas a Meta, y se hacen de a poco, despertandose con la alarma.
 * Entre tanda y tanda no hay nada vivo, asi que por donde iba tiene que
 * estar escrito.
 */
CREATE TABLE IF NOT EXISTS importacion (
    id           INTEGER PRIMARY KEY CHECK (id = 1),

    -- 'publicaciones' : trayendo la lista de publicaciones
    -- 'comentarios'   : recorriendolas y trayendo los comentarios
    -- 'lista'         : termino
    -- 'fallo'         : se rindio, y 'error' dice por que
    estado       TEXT    NOT NULL DEFAULT 'publicaciones',

    -- El cursor de Meta para seguir la lista de publicaciones.
    cursor_media TEXT,

    -- Cuantos comentarios se esperan en total. Sale de sumar el
    -- comments_count de cada publicacion, que Meta si devuelve, y es lo
    -- que permite que la barra de progreso diga la verdad en vez de
    -- fingir.
    total        INTEGER NOT NULL DEFAULT 0,
    traidos      INTEGER NOT NULL DEFAULT 0,

    llamadas     INTEGER NOT NULL DEFAULT 0,
    error        TEXT,
    empezada     TEXT    NOT NULL DEFAULT (datetime('now')),
    terminada    TEXT,
    ultimo_paso  TEXT
);

/*
 * Por que publicacion va la importacion de comentarios.
 *
 * Se recorren **de la mas reciente a la mas vieja**, que es el orden en
 * que Meta las devuelve y tambien el orden en que le sirven al cliente:
 * lo de esta semana importa mas que lo de hace tres anos.
 *
 * la columna cursor guarda por donde iba dentro de una publicacion con muchos
 * comentarios, para poder cortar a mitad y seguir en la tanda siguiente.
 */
CREATE TABLE IF NOT EXISTS importacion_medios (
    media_id  TEXT PRIMARY KEY,
    orden     INTEGER NOT NULL,
    esperados INTEGER NOT NULL DEFAULT 0,
    traidos   INTEGER NOT NULL DEFAULT 0,
    cursor    TEXT,
    hecho     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS importacion_pendiente ON importacion_medios (hecho, orden);
`,
    },

    {
        nombre: "lo que contesto el bot",
        sql: `
/*
 * El texto que se mando de verdad.
 *
 * Hasta ahora no se guardaba, y no hacia falta: la respuesta era la de
 * la automatizacion, asi que sabiendo cual disparo ya se sabia que se
 * mando.
 *
 * Con las respuestas escritas por la IA eso deja de ser cierto: **cada
 * una es distinta**. Sin guardarla, el panel solo podria decir
 * «respondido: si», que no le sirve a nadie: el cliente quiere leer que
 * se dijo en su nombre, y es lo primero que va a mirar.
 *
 * Van dos columnas porque son dos envios distintos —el privado y el
 * aviso publico— y pueden salir uno si y otro no.
 */
ALTER TABLE eventos ADD COLUMN respuesta TEXT;
ALTER TABLE eventos ADD COLUMN aviso_enviado TEXT;

/*
 * De donde salio la respuesta: 'ia' o 'fija'.
 *
 * Hace falta para dos cosas. Una, saber cuanto se usa la IA de verdad
 * frente a cuantas veces se cayo al texto de reserva. Y dos, que el
 * panel lo pueda decir: una respuesta escrita por la IA y una de
 * plantilla no son lo mismo para quien las lee, y esconder la diferencia
 * seria enganar al cliente sobre su propio producto.
 */
ALTER TABLE eventos ADD COLUMN origen TEXT;

/*
 * Lo que costo, en tokens.
 *
 * Se guardan los tokens y no los euros porque los tokens son un hecho y
 * el precio cambia. Los euros se derivan fuera, de una tabla de precios
 * con su fecha, y asi el historico se puede recalcular el dia que OpenAI
 * mueva las tarifas o se cambie de modelo.
 */
ALTER TABLE eventos ADD COLUMN tokens_entrada INTEGER;
ALTER TABLE eventos ADD COLUMN tokens_salida INTEGER;
`,
    },
];

/** La versión a la que llega un cliente al día de hoy. */
export const VERSION = PASOS.length;
