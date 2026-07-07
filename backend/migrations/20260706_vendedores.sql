-- 20260706_vendedores.sql
-- Catálogo de vendedores por negocio + sucursal y vínculo opcional en facturas.
--
-- CONTEXTO: cuando el negocio activa la config `vendedores_activo`, la persona que
-- factura debe indicar qué vendedor (de la sucursal activa) realizó cada venta.
-- El vendedor es un CATÁLOGO DE NOMBRES creado por el admin — NO son usuarios con login.
--
-- Es 100% ADITIVA: tabla nueva + columna nullable en facturas. No modifica ni
-- elimina nada existente. Los negocios que no activen la opción no ven cambios.
-- Aplicar ANTES de desplegar el código que lee/escribe vendedor_id.

-- 1) Tabla de vendedores (espejo de domiciliarios + sucursal_id)
CREATE TABLE IF NOT EXISTS public.vendedores (
    id serial PRIMARY KEY,
    negocio_id  integer NOT NULL,
    sucursal_id integer NOT NULL REFERENCES public.sucursales(id),
    nombre character varying(150) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    -- Nombre único por sucursal (permite el mismo nombre en distintas sucursales)
    CONSTRAINT vendedores_nombre_sucursal_uq UNIQUE (sucursal_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_vendedores_negocio  ON public.vendedores(negocio_id);
CREATE INDEX IF NOT EXISTS idx_vendedores_sucursal ON public.vendedores(sucursal_id);

-- 2) Columna nullable en facturas (sin FK con locks: la app garantiza integridad,
--    igual que domiciliario_id → entregas). NULL = factura sin vendedor asignado.
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS vendedor_id integer;

CREATE INDEX IF NOT EXISTS idx_facturas_vendedor ON public.facturas(vendedor_id);

-- ROLLBACK (si fuese necesario):
--   DROP INDEX IF EXISTS idx_facturas_vendedor;
--   ALTER TABLE public.facturas DROP COLUMN IF EXISTS vendedor_id;
--   DROP TABLE IF EXISTS public.vendedores;
