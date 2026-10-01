-- La base de control: quiénes son los clientes de la plataforma.
--
--   npx wrangler d1 execute bot-control --remote --file=base/control.sql
--
-- ── Qué va aquí y qué no ──────────────────────────────────────────
--
-- La regla, y sirve para no dudar nunca: **si borrar a un cliente tiene
-- que borrarlo, va en la base del cliente.** Sus conversaciones, sus
-- automatizaciones y sus contactos son suyos y viven en su base. Que él
-- exista, no.
--
-- Esta base es de la plataforma. Aquí no hay ni un dato de las personas que
-- escriben a los clientes, y eso no es casualidad: el día que haya que
-- explicarle a Meta cómo se separan los datos de unos negocios de otros,
-- la respuesta es que ni siquiera están en el mismo sitio.

CREATE TABLE IF NOT EXISTS clientes (
    -- La clave corta, en minúsculas y sin espacios. **Forma el nombre
    -- del enlace a su base** (`C_<clave>` en wrangler.jsonc) y el de la
    -- base misma, así que cambiarla después obliga a redesplegar y a
    -- renombrar. Se elige una vez y no se toca.
    clave        TEXT PRIMARY KEY,

    nombre       TEXT NOT NULL,

    -- El id de la cuenta de Instagram, que es **la única llave que manda
    -- Meta** en un webhook. Único a propósito: dos clientes no pueden
    -- compartir cuenta, y si alguna vez se intentara, salta aquí en vez
    -- de repartir los mensajes de uno al otro.
    cuenta_ig    TEXT NOT NULL UNIQUE,

    -- La Página de Facebook enlazada. Hace falta para suscribirla al
    -- webhook, que es el paso que de verdad hace llegar los eventos.
    pagina_fb    TEXT,

    -- El token con el que se le responde a su gente. **Es del cliente,
    -- no nuestro**: se lo dio a la app al conectar su cuenta, y deja de
    -- valer en cuanto la desconecte. Por eso se guarda aquí y no en la
    -- configuración del Worker: un token por cliente, que se puede
    -- borrar sin desplegar nada.
    token        TEXT,

    -- 'alta'  : se le atiende.
    -- 'pausa' : sigue existiendo, pero el bot no le contesta a nadie.
    -- 'baja'  : se fue. Su base se borra aparte, a propósito, para que
    --           darle de baja y destruir sus datos sean dos actos y no
    --           uno solo hecho sin querer.
    estado       TEXT NOT NULL DEFAULT 'alta',

    -- El identificador de su base en Cloudflare. No lo usa el Worker,
    -- que va por el enlace: sirve para las herramientas, que sí pueden
    -- llamar a la API de administración.
    base_id      TEXT,

    -- Cuando se renovo su token por ultima vez.
    --
    -- Un token largo de Instagram dura 60 dias, pero **se puede renovar
    -- indefinidamente** mientras se renueve antes de que caduque. Asi
    -- que a un cliente no tiene por que caducarsele nunca: si le caduca,
    -- es que fallamos nosotros. Esta fecha es lo que permite renovarlo a
    -- tiempo y, sobre todo, notar que dejo de renovarse.
    token_renovado TEXT,

    -- Como esta hoy: 'bien', o el nombre de lo que esta roto.
    --
    -- 'token'       : su token ya no sirve. Desconecto la app, cambio la
    --                 contrasena o Meta lo revoco. Hay que pedirle que
    --                 vuelva a conectar.
    -- 'suscripcion' : el token sirve pero su cuenta no esta suscrita al
    --                 webhook, asi que no le llega nada. Se arregla sin
    --                 molestarle.
    salud        TEXT NOT NULL DEFAULT 'sin revisar',
    salud_desde  TEXT,

    plan         TEXT,
    alta         TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Buscar por cuenta es lo que hace el Worker en CADA webhook, así que es
-- la única consulta que tiene que ser rápida sí o sí.
CREATE INDEX IF NOT EXISTS clientes_por_cuenta ON clientes (cuenta_ig, estado);

-- ── El registro de lo que pasa con los clientes ───────────────────
--
-- Altas, bajas, pausas y cambios de token. Existe por un motivo muy
-- concreto: cuando un cliente diga «desde el martes no contesta», hay
-- que poder mirar si el martes le caducó el token o alguien lo pausó.
-- Sin esto, la respuesta es encogerse de hombros.
CREATE TABLE IF NOT EXISTS movimientos (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente  TEXT NOT NULL REFERENCES clientes(clave),
    -- 'alta', 'pausa', 'reanudacion', 'baja', 'token', 'error'
    tipo     TEXT NOT NULL,
    detalle  TEXT,
    cuando   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS movimientos_por_cliente ON movimientos (cliente, cuando DESC);

-- ── La marca de lo que corre una vez al dia ───────────────────────
--
-- El cron de este Worker va cada cinco minutos, porque eso es lo que
-- necesitan los mensajes programados. Renovar tokens y revisar la salud
-- no: eso va una vez al dia.
--
-- En vez de anadir un segundo cron, que seria otra cosa que puede estar
-- mal configurada sin que se note, la pasada diaria se controla con una
-- marca aqui. Tiene una ventaja que no es menor: si el Worker estuvo
-- caido, al volver ve que la marca es vieja y lo hace, en vez de
-- esperar a la hora exacta del dia siguiente.
-- ── Las solicitudes de borrado de datos ───────────────────────────
--
-- Meta exige una dirección a la que avisar cuando alguien pide que se
-- borren sus datos, y espera que le devolvamos un código con el que esa
-- persona pueda seguir el trámite. Sin eso no aprueba la revisión, y
-- además es lo que toca por el reglamento.
--
-- Se guardan aquí, en la base de la plataforma y no en la del cliente,
-- por un motivo concreto: una solicitud tiene que sobrevivir al borrado
-- de lo que pide borrar. Si viviera en la base del cliente, atenderla
-- destruiría el registro de haberla atendido, que es justo lo que hay
-- que poder enseñar si alguien pregunta.
CREATE TABLE IF NOT EXISTS borrados (
    -- El código que se le devuelve a Meta y que la persona usa para
    -- consultar. Va en la URL de seguimiento, así que no lleva nada
    -- que identifique a nadie.
    codigo     TEXT PRIMARY KEY,

    -- Quién lo pidió, tal como lo manda Meta.
    quien      TEXT NOT NULL,

    -- De qué cliente es, si se pudo averiguar. Nulo cuando el id no
    -- corresponde a ninguna cuenta conocida, que también hay que
    -- registrar: una solicitud que no se entiende no se descarta.
    cliente    TEXT,

    -- 'recibida' | 'hecha'
    estado     TEXT NOT NULL DEFAULT 'recibida',
    recibida   TEXT NOT NULL DEFAULT (datetime('now')),
    terminada  TEXT,
    nota       TEXT
);

CREATE TABLE IF NOT EXISTS plataforma (
    clave  TEXT PRIMARY KEY,
    valor  TEXT
);
