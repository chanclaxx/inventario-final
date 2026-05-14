--
-- PostgreSQL database dump
--

\restrict AcIK3rthvOWgrgkpQymD9WoLZaycJguP6OpWgiubrYIeFjkLQC5eNgxz6vAUIlg

-- Dumped from database version 17.7 (Debian 17.7-3.pgdg13+1)
-- Dumped by pg_dump version 18.1

-- Started on 2026-05-14 00:48:53

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 2 (class 3079 OID 16389)
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- TOC entry 4152 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- TOC entry 1075 (class 1247 OID 17238)
-- Name: estado_entrega; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.estado_entrega AS ENUM (
    'Pendiente',
    'Entregado',
    'No_entregado'
);


ALTER TYPE public.estado_entrega OWNER TO postgres;

--
-- TOC entry 967 (class 1247 OID 16427)
-- Name: rol_usuario; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.rol_usuario AS ENUM (
    'admin_negocio',
    'supervisor',
    'vendedor'
);


ALTER TYPE public.rol_usuario OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 218 (class 1259 OID 16433)
-- Name: abonos_credito; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.abonos_credito (
    id integer NOT NULL,
    credito_id integer NOT NULL,
    usuario_id integer,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    valor numeric(12,2) NOT NULL,
    metodo character varying(30) DEFAULT 'Efectivo'::character varying NOT NULL,
    notas text
);


ALTER TABLE public.abonos_credito OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16440)
-- Name: abonos_credito_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.abonos_credito_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.abonos_credito_id_seq OWNER TO postgres;

--
-- TOC entry 4153 (class 0 OID 0)
-- Dependencies: 219
-- Name: abonos_credito_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.abonos_credito_id_seq OWNED BY public.abonos_credito.id;


--
-- TOC entry 290 (class 1259 OID 17285)
-- Name: abonos_domicilio; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.abonos_domicilio (
    id integer NOT NULL,
    entrega_id integer NOT NULL,
    negocio_id integer NOT NULL,
    usuario_id integer,
    valor numeric(12,2) NOT NULL,
    notas text,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT abonos_domicilio_valor_check CHECK ((valor > (0)::numeric))
);


ALTER TABLE public.abonos_domicilio OWNER TO postgres;

--
-- TOC entry 289 (class 1259 OID 17284)
-- Name: abonos_domicilio_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.abonos_domicilio_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.abonos_domicilio_id_seq OWNER TO postgres;

--
-- TOC entry 4154 (class 0 OID 0)
-- Dependencies: 289
-- Name: abonos_domicilio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.abonos_domicilio_id_seq OWNED BY public.abonos_domicilio.id;


--
-- TOC entry 220 (class 1259 OID 16441)
-- Name: abonos_prestamo; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.abonos_prestamo (
    id integer NOT NULL,
    prestamo_id integer NOT NULL,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    valor numeric(12,2) NOT NULL,
    metodo character varying(50) DEFAULT 'Efectivo'::character varying,
    usuario_id integer
);


ALTER TABLE public.abonos_prestamo OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16445)
-- Name: abonos_prestamo_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.abonos_prestamo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.abonos_prestamo_id_seq OWNER TO postgres;

--
-- TOC entry 4155 (class 0 OID 0)
-- Dependencies: 221
-- Name: abonos_prestamo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.abonos_prestamo_id_seq OWNED BY public.abonos_prestamo.id;


--
-- TOC entry 294 (class 1259 OID 17369)
-- Name: abonos_servicio; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.abonos_servicio (
    id integer NOT NULL,
    orden_id integer NOT NULL,
    usuario_id integer,
    valor numeric(12,2) NOT NULL,
    metodo character varying(30) DEFAULT 'Efectivo'::character varying NOT NULL,
    notas text,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT abonos_servicio_valor_check CHECK ((valor > (0)::numeric))
);


ALTER TABLE public.abonos_servicio OWNER TO postgres;

--
-- TOC entry 293 (class 1259 OID 17368)
-- Name: abonos_servicio_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.abonos_servicio_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.abonos_servicio_id_seq OWNER TO postgres;

--
-- TOC entry 4156 (class 0 OID 0)
-- Dependencies: 293
-- Name: abonos_servicio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.abonos_servicio_id_seq OWNED BY public.abonos_servicio.id;


--
-- TOC entry 222 (class 1259 OID 16446)
-- Name: acreedores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.acreedores (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    cedula character varying(30) NOT NULL,
    telefono character varying(20),
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    proveedor_id integer
);


ALTER TABLE public.acreedores OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16450)
-- Name: acreedores_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.acreedores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.acreedores_id_seq OWNER TO postgres;

--
-- TOC entry 4157 (class 0 OID 0)
-- Dependencies: 223
-- Name: acreedores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.acreedores_id_seq OWNED BY public.acreedores.id;


--
-- TOC entry 224 (class 1259 OID 16451)
-- Name: aperturas_caja; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.aperturas_caja (
    id integer NOT NULL,
    sucursal_id integer NOT NULL,
    usuario_id integer,
    fecha_apertura timestamp without time zone DEFAULT now() NOT NULL,
    monto_inicial numeric(12,2) DEFAULT 0 NOT NULL,
    fecha_cierre timestamp without time zone,
    monto_cierre numeric(12,2),
    estado character varying(10) DEFAULT 'Abierta'::character varying NOT NULL,
    CONSTRAINT aperturas_caja_estado_check CHECK (((estado)::text = ANY (ARRAY[('Abierta'::character varying)::text, ('Cerrada'::character varying)::text])))
);


ALTER TABLE public.aperturas_caja OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16458)
-- Name: aperturas_caja_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.aperturas_caja_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.aperturas_caja_id_seq OWNER TO postgres;

--
-- TOC entry 4158 (class 0 OID 0)
-- Dependencies: 225
-- Name: aperturas_caja_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.aperturas_caja_id_seq OWNED BY public.aperturas_caja.id;


--
-- TOC entry 226 (class 1259 OID 16459)
-- Name: auditoria; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auditoria (
    id integer NOT NULL,
    negocio_id integer,
    usuario_id integer,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    accion character varying(100) NOT NULL,
    tabla character varying(100),
    registro_id integer,
    detalle text
);


ALTER TABLE public.auditoria OWNER TO postgres;

--
-- TOC entry 227 (class 1259 OID 16465)
-- Name: auditoria_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.auditoria_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auditoria_id_seq OWNER TO postgres;

--
-- TOC entry 4159 (class 0 OID 0)
-- Dependencies: 227
-- Name: auditoria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.auditoria_id_seq OWNED BY public.auditoria.id;


--
-- TOC entry 228 (class 1259 OID 16466)
-- Name: clientes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.clientes (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    cedula character varying(30) NOT NULL,
    celular character varying(20),
    email character varying(150),
    direccion text,
    fecha_registro timestamp without time zone DEFAULT now() NOT NULL,
    saldo_a_favor numeric(12,2) DEFAULT 0
);


ALTER TABLE public.clientes OWNER TO postgres;

--
-- TOC entry 300 (class 1259 OID 17522)
-- Name: clientes_frecuentes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.clientes_frecuentes (
    id integer NOT NULL,
    sucursal_id integer NOT NULL,
    cliente_id integer NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.clientes_frecuentes OWNER TO postgres;

--
-- TOC entry 299 (class 1259 OID 17521)
-- Name: clientes_frecuentes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.clientes_frecuentes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.clientes_frecuentes_id_seq OWNER TO postgres;

--
-- TOC entry 4160 (class 0 OID 0)
-- Dependencies: 299
-- Name: clientes_frecuentes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.clientes_frecuentes_id_seq OWNED BY public.clientes_frecuentes.id;


--
-- TOC entry 229 (class 1259 OID 16472)
-- Name: clientes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.clientes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.clientes_id_seq OWNER TO postgres;

--
-- TOC entry 4161 (class 0 OID 0)
-- Dependencies: 229
-- Name: clientes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.clientes_id_seq OWNED BY public.clientes.id;


--
-- TOC entry 230 (class 1259 OID 16473)
-- Name: compras; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.compras (
    id integer NOT NULL,
    sucursal_id integer NOT NULL,
    proveedor_id integer NOT NULL,
    usuario_id integer,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    numero_factura character varying(50),
    total numeric(12,2) DEFAULT 0 NOT NULL,
    estado character varying(20) DEFAULT 'Completada'::character varying NOT NULL,
    notas text,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    registrar_en_caja boolean DEFAULT true NOT NULL,
    metodo character varying(50),
    CONSTRAINT compras_estado_check CHECK (((estado)::text = ANY (ARRAY[('Completada'::character varying)::text, ('Pendiente'::character varying)::text, ('Cancelada'::character varying)::text])))
);


ALTER TABLE public.compras OWNER TO postgres;

--
-- TOC entry 231 (class 1259 OID 16483)
-- Name: compras_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.compras_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.compras_id_seq OWNER TO postgres;

--
-- TOC entry 4162 (class 0 OID 0)
-- Dependencies: 231
-- Name: compras_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.compras_id_seq OWNED BY public.compras.id;


--
-- TOC entry 232 (class 1259 OID 16484)
-- Name: config_negocio; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.config_negocio (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    clave character varying(100) NOT NULL,
    valor text DEFAULT ''::text NOT NULL,
    descripcion text
);


ALTER TABLE public.config_negocio OWNER TO postgres;

--
-- TOC entry 233 (class 1259 OID 16490)
-- Name: config_negocio_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.config_negocio_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.config_negocio_id_seq OWNER TO postgres;

--
-- TOC entry 4163 (class 0 OID 0)
-- Dependencies: 233
-- Name: config_negocio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.config_negocio_id_seq OWNED BY public.config_negocio.id;


--
-- TOC entry 234 (class 1259 OID 16491)
-- Name: creditos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.creditos (
    id integer NOT NULL,
    factura_id integer NOT NULL,
    cliente_id integer,
    sucursal_id integer NOT NULL,
    valor_total numeric(12,2) NOT NULL,
    total_abonado numeric(12,2) DEFAULT 0 NOT NULL,
    estado character varying(20) DEFAULT 'Activo'::character varying NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    cuota_inicial numeric(12,2) DEFAULT 0 NOT NULL,
    CONSTRAINT creditos_estado_check CHECK (((estado)::text = ANY ((ARRAY['Activo'::character varying, 'Saldado'::character varying, 'Cancelado'::character varying])::text[])))
);


ALTER TABLE public.creditos OWNER TO postgres;

--
-- TOC entry 235 (class 1259 OID 16499)
-- Name: creditos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.creditos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.creditos_id_seq OWNER TO postgres;

--
-- TOC entry 4164 (class 0 OID 0)
-- Dependencies: 235
-- Name: creditos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.creditos_id_seq OWNED BY public.creditos.id;


--
-- TOC entry 286 (class 1259 OID 17221)
-- Name: domiciliarios; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.domiciliarios (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    telefono character varying(20),
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.domiciliarios OWNER TO postgres;

--
-- TOC entry 285 (class 1259 OID 17220)
-- Name: domiciliarios_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.domiciliarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.domiciliarios_id_seq OWNER TO postgres;

--
-- TOC entry 4165 (class 0 OID 0)
-- Dependencies: 285
-- Name: domiciliarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.domiciliarios_id_seq OWNED BY public.domiciliarios.id;


--
-- TOC entry 277 (class 1259 OID 17039)
-- Name: empleados_prestatario; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.empleados_prestatario (
    id integer NOT NULL,
    prestatario_id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.empleados_prestatario OWNER TO postgres;

--
-- TOC entry 276 (class 1259 OID 17038)
-- Name: empleados_prestatario_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.empleados_prestatario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.empleados_prestatario_id_seq OWNER TO postgres;

--
-- TOC entry 4166 (class 0 OID 0)
-- Dependencies: 276
-- Name: empleados_prestatario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.empleados_prestatario_id_seq OWNED BY public.empleados_prestatario.id;


--
-- TOC entry 288 (class 1259 OID 17246)
-- Name: entregas_domicilio; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entregas_domicilio (
    id integer NOT NULL,
    factura_id integer NOT NULL,
    domiciliario_id integer NOT NULL,
    negocio_id integer NOT NULL,
    usuario_id integer,
    valor_total numeric(12,2) NOT NULL,
    total_abonado numeric(12,2) DEFAULT 0 NOT NULL,
    estado public.estado_entrega DEFAULT 'Pendiente'::public.estado_entrega NOT NULL,
    direccion_entrega text,
    notas text,
    fecha_asignacion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_entrega timestamp without time zone,
    CONSTRAINT entrega_domiciliario_mismo_negocio CHECK ((negocio_id = negocio_id))
);


ALTER TABLE public.entregas_domicilio OWNER TO postgres;

--
-- TOC entry 287 (class 1259 OID 17245)
-- Name: entregas_domicilio_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entregas_domicilio_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entregas_domicilio_id_seq OWNER TO postgres;

--
-- TOC entry 4167 (class 0 OID 0)
-- Dependencies: 287
-- Name: entregas_domicilio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entregas_domicilio_id_seq OWNED BY public.entregas_domicilio.id;


--
-- TOC entry 236 (class 1259 OID 16500)
-- Name: facturas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.facturas (
    id integer NOT NULL,
    sucursal_id integer NOT NULL,
    usuario_id integer,
    cliente_id integer,
    nombre_cliente character varying(150) NOT NULL,
    cedula character varying(30) NOT NULL,
    celular character varying(20) NOT NULL,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    estado character varying(20) DEFAULT 'Activa'::character varying NOT NULL,
    notas text,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT facturas_estado_check CHECK (((estado)::text = ANY (ARRAY[('Activa'::character varying)::text, ('Cancelada'::character varying)::text, ('Credito'::character varying)::text])))
);


ALTER TABLE public.facturas OWNER TO postgres;

--
-- TOC entry 237 (class 1259 OID 16509)
-- Name: facturas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.facturas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.facturas_id_seq OWNER TO postgres;

--
-- TOC entry 4168 (class 0 OID 0)
-- Dependencies: 237
-- Name: facturas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.facturas_id_seq OWNED BY public.facturas.id;


--
-- TOC entry 238 (class 1259 OID 16510)
-- Name: garantias; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.garantias (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    titulo character varying(150) NOT NULL,
    texto text NOT NULL,
    orden integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.garantias OWNER TO postgres;

--
-- TOC entry 239 (class 1259 OID 16516)
-- Name: garantias_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.garantias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.garantias_id_seq OWNER TO postgres;

--
-- TOC entry 4169 (class 0 OID 0)
-- Dependencies: 239
-- Name: garantias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.garantias_id_seq OWNED BY public.garantias.id;


--
-- TOC entry 282 (class 1259 OID 17147)
-- Name: garantias_lineas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.garantias_lineas (
    garantia_id integer NOT NULL,
    linea_id integer NOT NULL
);


ALTER TABLE public.garantias_lineas OWNER TO postgres;

--
-- TOC entry 279 (class 1259 OID 17076)
-- Name: historial_stock_cantidad; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.historial_stock_cantidad (
    id integer NOT NULL,
    producto_id integer NOT NULL,
    sucursal_id integer NOT NULL,
    cantidad integer NOT NULL,
    costo_unitario numeric(12,2),
    tipo character varying(20) DEFAULT 'ajuste'::character varying NOT NULL,
    cliente_origen character varying(150),
    cedula_cliente character varying(30),
    proveedor_id integer,
    notas text,
    creado_en timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.historial_stock_cantidad OWNER TO postgres;

--
-- TOC entry 278 (class 1259 OID 17075)
-- Name: historial_stock_cantidad_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.historial_stock_cantidad_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.historial_stock_cantidad_id_seq OWNER TO postgres;

--
-- TOC entry 4170 (class 0 OID 0)
-- Dependencies: 278
-- Name: historial_stock_cantidad_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.historial_stock_cantidad_id_seq OWNED BY public.historial_stock_cantidad.id;


--
-- TOC entry 240 (class 1259 OID 16517)
-- Name: lineas_compra; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lineas_compra (
    id integer NOT NULL,
    compra_id integer NOT NULL,
    nombre_producto character varying(150) NOT NULL,
    imei character varying(50),
    cantidad integer DEFAULT 1 NOT NULL,
    precio_unitario numeric(12,2) NOT NULL,
    subtotal numeric(12,2) GENERATED ALWAYS AS (((cantidad)::numeric * precio_unitario)) STORED,
    precio_usd numeric(12,2),
    factor_conversion numeric(10,4),
    valor_traida numeric(12,2)
);


ALTER TABLE public.lineas_compra OWNER TO postgres;

--
-- TOC entry 241 (class 1259 OID 16522)
-- Name: lineas_compra_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lineas_compra_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lineas_compra_id_seq OWNER TO postgres;

--
-- TOC entry 4171 (class 0 OID 0)
-- Dependencies: 241
-- Name: lineas_compra_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lineas_compra_id_seq OWNED BY public.lineas_compra.id;


--
-- TOC entry 242 (class 1259 OID 16523)
-- Name: lineas_factura; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lineas_factura (
    id integer NOT NULL,
    factura_id integer NOT NULL,
    nombre_producto character varying(150) NOT NULL,
    imei character varying(50),
    cantidad integer DEFAULT 1 NOT NULL,
    precio numeric(12,2) NOT NULL,
    subtotal numeric(12,2) GENERATED ALWAYS AS (((cantidad)::numeric * precio)) STORED,
    producto_id integer
);


ALTER TABLE public.lineas_factura OWNER TO postgres;

--
-- TOC entry 243 (class 1259 OID 16528)
-- Name: lineas_factura_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lineas_factura_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lineas_factura_id_seq OWNER TO postgres;

--
-- TOC entry 4172 (class 0 OID 0)
-- Dependencies: 243
-- Name: lineas_factura_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lineas_factura_id_seq OWNED BY public.lineas_factura.id;


--
-- TOC entry 281 (class 1259 OID 17123)
-- Name: lineas_producto; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lineas_producto (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    creado_en timestamp without time zone DEFAULT now()
);


ALTER TABLE public.lineas_producto OWNER TO postgres;

--
-- TOC entry 280 (class 1259 OID 17122)
-- Name: lineas_producto_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lineas_producto_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lineas_producto_id_seq OWNER TO postgres;

--
-- TOC entry 4173 (class 0 OID 0)
-- Dependencies: 280
-- Name: lineas_producto_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lineas_producto_id_seq OWNED BY public.lineas_producto.id;


--
-- TOC entry 298 (class 1259 OID 17458)
-- Name: lineas_traslado; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lineas_traslado (
    id integer NOT NULL,
    traslado_id integer NOT NULL,
    tipo character varying(20) NOT NULL,
    serial_id integer,
    producto_serial_origen_id integer,
    producto_serial_destino_id integer,
    imei character varying(50),
    producto_cantidad_origen_id integer,
    producto_cantidad_destino_id integer,
    cantidad integer,
    nombre_producto character varying(150) NOT NULL,
    revertida boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_linea_tipo CHECK (((tipo)::text = ANY ((ARRAY['serial'::character varying, 'cantidad'::character varying])::text[])))
);


ALTER TABLE public.lineas_traslado OWNER TO postgres;

--
-- TOC entry 297 (class 1259 OID 17457)
-- Name: lineas_traslado_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lineas_traslado_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lineas_traslado_id_seq OWNER TO postgres;

--
-- TOC entry 4174 (class 0 OID 0)
-- Dependencies: 297
-- Name: lineas_traslado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lineas_traslado_id_seq OWNED BY public.lineas_traslado.id;


--
-- TOC entry 244 (class 1259 OID 16529)
-- Name: movimientos_acreedor; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.movimientos_acreedor (
    id integer NOT NULL,
    acreedor_id integer NOT NULL,
    usuario_id integer,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    tipo character varying(10) DEFAULT 'Abono'::character varying NOT NULL,
    valor numeric(12,2) NOT NULL,
    descripcion text NOT NULL,
    firma bytea,
    compra_id integer,
    registrar_en_caja boolean DEFAULT true NOT NULL,
    metodo character varying(50),
    cargo_id integer,
    CONSTRAINT movimientos_acreedor_tipo_check CHECK (((tipo)::text = ANY (ARRAY[('Abono'::character varying)::text, ('Cargo'::character varying)::text])))
);


ALTER TABLE public.movimientos_acreedor OWNER TO postgres;

--
-- TOC entry 245 (class 1259 OID 16537)
-- Name: movimientos_acreedor_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.movimientos_acreedor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.movimientos_acreedor_id_seq OWNER TO postgres;

--
-- TOC entry 4175 (class 0 OID 0)
-- Dependencies: 245
-- Name: movimientos_acreedor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.movimientos_acreedor_id_seq OWNED BY public.movimientos_acreedor.id;


--
-- TOC entry 246 (class 1259 OID 16538)
-- Name: movimientos_caja; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.movimientos_caja (
    id integer NOT NULL,
    caja_id integer NOT NULL,
    usuario_id integer,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    tipo character varying(10) NOT NULL,
    concepto character varying(150) NOT NULL,
    valor numeric(12,2) NOT NULL,
    referencia_id integer,
    referencia_tipo character varying(50),
    activo boolean DEFAULT true NOT NULL,
    metodo character varying(50),
    CONSTRAINT movimientos_caja_tipo_check CHECK (((tipo)::text = ANY (ARRAY[('Ingreso'::character varying)::text, ('Egreso'::character varying)::text])))
);


ALTER TABLE public.movimientos_caja OWNER TO postgres;

--
-- TOC entry 247 (class 1259 OID 16543)
-- Name: movimientos_caja_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.movimientos_caja_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.movimientos_caja_id_seq OWNER TO postgres;

--
-- TOC entry 4176 (class 0 OID 0)
-- Dependencies: 247
-- Name: movimientos_caja_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.movimientos_caja_id_seq OWNED BY public.movimientos_caja.id;


--
-- TOC entry 302 (class 1259 OID 17771)
-- Name: movimientos_prestatario; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.movimientos_prestatario (
    id integer NOT NULL,
    prestatario_id integer NOT NULL,
    sucursal_id integer NOT NULL,
    usuario_id integer,
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    tipo character varying(25) NOT NULL,
    signo smallint NOT NULL,
    valor numeric(12,2) NOT NULL,
    descripcion text,
    metodo character varying(50),
    registrar_en_caja boolean DEFAULT false NOT NULL,
    nombre_producto character varying(150),
    imei character varying(50),
    producto_serial_id integer,
    producto_cantidad_id integer,
    cantidad integer DEFAULT 1,
    color character varying(50),
    ingreso_inventario boolean,
    costo_producto numeric(12,2),
    anulado boolean DEFAULT false NOT NULL,
    anulado_en timestamp with time zone,
    anulado_por integer,
    motivo_anulacion text,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_movpre_signo CHECK ((signo = ANY (ARRAY[1, '-1'::integer]))),
    CONSTRAINT chk_movpre_tipo CHECK (((tipo)::text = ANY ((ARRAY['entrega_producto'::character varying, 'recibo_producto'::character varying, 'pago_recibido'::character varying, 'pago_enviado'::character varying, 'ajuste_manual'::character varying])::text[]))),
    CONSTRAINT chk_movpre_valor CHECK ((valor > (0)::numeric))
);


ALTER TABLE public.movimientos_prestatario OWNER TO postgres;

--
-- TOC entry 301 (class 1259 OID 17770)
-- Name: movimientos_prestatario_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.movimientos_prestatario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.movimientos_prestatario_id_seq OWNER TO postgres;

--
-- TOC entry 4177 (class 0 OID 0)
-- Dependencies: 301
-- Name: movimientos_prestatario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.movimientos_prestatario_id_seq OWNED BY public.movimientos_prestatario.id;


--
-- TOC entry 248 (class 1259 OID 16544)
-- Name: negocios; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.negocios (
    id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    email character varying(150) NOT NULL,
    telefono character varying(20),
    direccion text,
    nit character varying(30),
    plan character varying(30) DEFAULT 'trial'::character varying NOT NULL,
    estado_plan character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
    fecha_inicio timestamp without time zone DEFAULT now() NOT NULL,
    fecha_vencimiento timestamp without time zone DEFAULT (now() + '15 days'::interval) NOT NULL,
    max_sucursales integer DEFAULT 1 NOT NULL,
    max_usuarios integer DEFAULT 5 NOT NULL,
    notas_admin text,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT negocios_estado_plan_check CHECK (((estado_plan)::text = ANY (ARRAY[('activo'::character varying)::text, ('vencido'::character varying)::text, ('suspendido'::character varying)::text, ('pendiente'::character varying)::text]))),
    CONSTRAINT negocios_plan_check CHECK (((plan)::text = ANY ((ARRAY['basico'::character varying, 'pro'::character varying])::text[])))
);


ALTER TABLE public.negocios OWNER TO postgres;

--
-- TOC entry 249 (class 1259 OID 16559)
-- Name: negocios_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.negocios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.negocios_id_seq OWNER TO postgres;

--
-- TOC entry 4178 (class 0 OID 0)
-- Dependencies: 249
-- Name: negocios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.negocios_id_seq OWNED BY public.negocios.id;


--
-- TOC entry 292 (class 1259 OID 17329)
-- Name: ordenes_servicio; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ordenes_servicio (
    id integer NOT NULL,
    sucursal_id integer NOT NULL,
    negocio_id integer NOT NULL,
    usuario_id integer,
    cliente_nombre character varying(150) NOT NULL,
    cliente_telefono character varying(20),
    cliente_id integer,
    equipo_tipo character varying(50),
    equipo_nombre character varying(100),
    equipo_serial character varying(100),
    falla_reportada text NOT NULL,
    contrasena_equipo character varying(100),
    notas_tecnico text,
    costo_estimado numeric(12,2),
    costo_real numeric(12,2),
    precio_final numeric(12,2),
    total_abonado numeric(12,2) DEFAULT 0 NOT NULL,
    motivo_sin_reparar character varying(100),
    garantia_cobrable boolean DEFAULT false NOT NULL,
    orden_origen_id integer,
    estado character varying(20) DEFAULT 'Recibido'::character varying NOT NULL,
    fecha_recepcion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_entrega timestamp without time zone,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    cliente_cedula character varying(30),
    precio_garantia numeric(12,2),
    costo_garantia numeric(12,2),
    checklist_equipo jsonb,
    patron_desbloqueo jsonb,
    factura_id integer,
    CONSTRAINT ordenes_servicio_estado_check CHECK (((estado)::text = ANY ((ARRAY['Recibido'::character varying, 'En_reparacion'::character varying, 'Listo'::character varying, 'Entregado'::character varying, 'Pendiente_pago'::character varying, 'Sin_reparar'::character varying, 'Garantia'::character varying])::text[])))
);


ALTER TABLE public.ordenes_servicio OWNER TO postgres;

--
-- TOC entry 291 (class 1259 OID 17328)
-- Name: ordenes_servicio_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ordenes_servicio_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ordenes_servicio_id_seq OWNER TO postgres;

--
-- TOC entry 4179 (class 0 OID 0)
-- Dependencies: 291
-- Name: ordenes_servicio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ordenes_servicio_id_seq OWNED BY public.ordenes_servicio.id;


--
-- TOC entry 250 (class 1259 OID 16560)
-- Name: pagos_factura; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pagos_factura (
    id integer NOT NULL,
    factura_id integer NOT NULL,
    metodo character varying(30) NOT NULL,
    valor numeric(12,2) NOT NULL
);


ALTER TABLE public.pagos_factura OWNER TO postgres;

--
-- TOC entry 251 (class 1259 OID 16564)
-- Name: pagos_factura_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pagos_factura_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pagos_factura_id_seq OWNER TO postgres;

--
-- TOC entry 4180 (class 0 OID 0)
-- Dependencies: 251
-- Name: pagos_factura_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pagos_factura_id_seq OWNED BY public.pagos_factura.id;


--
-- TOC entry 252 (class 1259 OID 16565)
-- Name: pagos_plan; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pagos_plan (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    valor numeric(10,2) NOT NULL,
    plan character varying(30) NOT NULL,
    metodo character varying(50) DEFAULT 'Manual'::character varying NOT NULL,
    referencia character varying(100),
    meses integer DEFAULT 1 NOT NULL,
    fecha_desde timestamp without time zone NOT NULL,
    fecha_hasta timestamp without time zone NOT NULL,
    registrado_por integer,
    notas text
);


ALTER TABLE public.pagos_plan OWNER TO postgres;

--
-- TOC entry 253 (class 1259 OID 16573)
-- Name: pagos_plan_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pagos_plan_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pagos_plan_id_seq OWNER TO postgres;

--
-- TOC entry 4181 (class 0 OID 0)
-- Dependencies: 253
-- Name: pagos_plan_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pagos_plan_id_seq OWNED BY public.pagos_plan.id;


--
-- TOC entry 254 (class 1259 OID 16574)
-- Name: planes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.planes (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    precio_mensual numeric(10,2) NOT NULL,
    max_sucursales integer DEFAULT 1 NOT NULL,
    max_usuarios integer DEFAULT 5 NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL
);


ALTER TABLE public.planes OWNER TO postgres;

--
-- TOC entry 255 (class 1259 OID 16582)
-- Name: planes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.planes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.planes_id_seq OWNER TO postgres;

--
-- TOC entry 4182 (class 0 OID 0)
-- Dependencies: 255
-- Name: planes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.planes_id_seq OWNED BY public.planes.id;


--
-- TOC entry 256 (class 1259 OID 16583)
-- Name: prestamos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.prestamos (
    id integer NOT NULL,
    sucursal_id integer NOT NULL,
    usuario_id integer,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    prestatario character varying(150) NOT NULL,
    cedula character varying(30) NOT NULL,
    telefono character varying(20) NOT NULL,
    nombre_producto character varying(150) NOT NULL,
    imei character varying(50),
    producto_id integer,
    cantidad_prestada integer DEFAULT 1 NOT NULL,
    valor_prestamo numeric(12,2) NOT NULL,
    total_abonado numeric(12,2) DEFAULT 0 NOT NULL,
    estado character varying(20) DEFAULT 'Activo'::character varying NOT NULL,
    prestatario_id integer,
    empleado_id integer,
    cliente_id integer,
    CONSTRAINT prestamos_estado_check CHECK (((estado)::text = ANY (ARRAY[('Activo'::character varying)::text, ('Saldado'::character varying)::text, ('Devuelto'::character varying)::text])))
);


ALTER TABLE public.prestamos OWNER TO postgres;

--
-- TOC entry 257 (class 1259 OID 16591)
-- Name: prestamos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.prestamos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.prestamos_id_seq OWNER TO postgres;

--
-- TOC entry 4183 (class 0 OID 0)
-- Dependencies: 257
-- Name: prestamos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.prestamos_id_seq OWNED BY public.prestamos.id;


--
-- TOC entry 275 (class 1259 OID 17026)
-- Name: prestatarios; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.prestatarios (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    telefono character varying(20),
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    saldo_a_favor numeric(12,2) DEFAULT 0,
    cc_migrado boolean DEFAULT false
);


ALTER TABLE public.prestatarios OWNER TO postgres;

--
-- TOC entry 274 (class 1259 OID 17025)
-- Name: prestatarios_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.prestatarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.prestatarios_id_seq OWNER TO postgres;

--
-- TOC entry 4184 (class 0 OID 0)
-- Dependencies: 274
-- Name: prestatarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.prestatarios_id_seq OWNED BY public.prestatarios.id;


--
-- TOC entry 258 (class 1259 OID 16592)
-- Name: productos_cantidad; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.productos_cantidad (
    id integer NOT NULL,
    sucursal_id integer NOT NULL,
    proveedor_id integer,
    nombre character varying(150) NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    stock_minimo integer DEFAULT 0 NOT NULL,
    cliente_origen character varying(150),
    unidad_medida character varying(30) DEFAULT 'unidad'::character varying,
    costo_unitario numeric(12,2),
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    precio numeric(12,2),
    linea_id integer
);


ALTER TABLE public.productos_cantidad OWNER TO postgres;

--
-- TOC entry 259 (class 1259 OID 16600)
-- Name: productos_cantidad_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.productos_cantidad_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.productos_cantidad_id_seq OWNER TO postgres;

--
-- TOC entry 4185 (class 0 OID 0)
-- Dependencies: 259
-- Name: productos_cantidad_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.productos_cantidad_id_seq OWNED BY public.productos_cantidad.id;


--
-- TOC entry 260 (class 1259 OID 16601)
-- Name: productos_serial; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.productos_serial (
    id integer NOT NULL,
    sucursal_id integer NOT NULL,
    proveedor_id integer,
    nombre character varying(150) NOT NULL,
    marca character varying(100),
    modelo character varying(100),
    precio numeric(12,2),
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    linea_id integer
);


ALTER TABLE public.productos_serial OWNER TO postgres;

--
-- TOC entry 261 (class 1259 OID 16606)
-- Name: productos_serial_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.productos_serial_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.productos_serial_id_seq OWNER TO postgres;

--
-- TOC entry 4186 (class 0 OID 0)
-- Dependencies: 261
-- Name: productos_serial_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.productos_serial_id_seq OWNED BY public.productos_serial.id;


--
-- TOC entry 262 (class 1259 OID 16607)
-- Name: proveedores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.proveedores (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    nit character varying(30),
    telefono character varying(20),
    email character varying(150),
    direccion text,
    contacto character varying(100),
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    tipo character varying(20) DEFAULT 'proveedor'::character varying NOT NULL,
    CONSTRAINT chk_proveedor_tipo CHECK (((tipo)::text = ANY ((ARRAY['proveedor'::character varying, 'cruce'::character varying])::text[])))
);


ALTER TABLE public.proveedores OWNER TO postgres;

--
-- TOC entry 263 (class 1259 OID 16614)
-- Name: proveedores_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.proveedores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.proveedores_id_seq OWNER TO postgres;

--
-- TOC entry 4187 (class 0 OID 0)
-- Dependencies: 263
-- Name: proveedores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.proveedores_id_seq OWNED BY public.proveedores.id;


--
-- TOC entry 264 (class 1259 OID 16615)
-- Name: retomas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.retomas (
    id integer NOT NULL,
    factura_id integer,
    descripcion text NOT NULL,
    valor_retoma numeric(12,2) NOT NULL,
    ingreso_inventario boolean DEFAULT false NOT NULL,
    nombre_producto character varying(150),
    imei character varying(50),
    cantidad_retoma integer DEFAULT 1 NOT NULL,
    prestamo_id integer,
    tipo_retoma character varying(20) DEFAULT 'serial'::character varying,
    producto_serial_id integer,
    producto_cantidad_id integer,
    costo_retoma numeric(12,2) DEFAULT 0,
    color character varying(50),
    tipo_persona character varying(20),
    persona_id integer,
    sucursal_id integer,
    fecha timestamp with time zone DEFAULT now()
);


ALTER TABLE public.retomas OWNER TO postgres;

--
-- TOC entry 265 (class 1259 OID 16621)
-- Name: retomas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.retomas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.retomas_id_seq OWNER TO postgres;

--
-- TOC entry 4188 (class 0 OID 0)
-- Dependencies: 265
-- Name: retomas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.retomas_id_seq OWNED BY public.retomas.id;


--
-- TOC entry 266 (class 1259 OID 16622)
-- Name: seriales; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.seriales (
    id integer NOT NULL,
    producto_id integer NOT NULL,
    imei character varying(50) NOT NULL,
    fecha_entrada date DEFAULT CURRENT_DATE NOT NULL,
    vendido boolean DEFAULT false NOT NULL,
    fecha_salida date,
    cliente_origen character varying(150),
    prestado boolean DEFAULT false NOT NULL,
    costo_compra numeric(12,2),
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    proveedor_id integer,
    color character varying(50),
    caracteristicas jsonb
);


ALTER TABLE public.seriales OWNER TO postgres;

--
-- TOC entry 267 (class 1259 OID 16629)
-- Name: seriales_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.seriales_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.seriales_id_seq OWNER TO postgres;

--
-- TOC entry 4189 (class 0 OID 0)
-- Dependencies: 267
-- Name: seriales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.seriales_id_seq OWNED BY public.seriales.id;


--
-- TOC entry 268 (class 1259 OID 16630)
-- Name: sucursales; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sucursales (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    direccion text,
    telefono character varying(20),
    activa boolean DEFAULT true NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.sucursales OWNER TO postgres;

--
-- TOC entry 269 (class 1259 OID 16637)
-- Name: sucursales_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sucursales_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sucursales_id_seq OWNER TO postgres;

--
-- TOC entry 4190 (class 0 OID 0)
-- Dependencies: 269
-- Name: sucursales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sucursales_id_seq OWNED BY public.sucursales.id;


--
-- TOC entry 270 (class 1259 OID 16638)
-- Name: superadmins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.superadmins (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    email character varying(150) NOT NULL,
    password_hash text NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.superadmins OWNER TO postgres;

--
-- TOC entry 271 (class 1259 OID 16645)
-- Name: superadmins_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.superadmins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.superadmins_id_seq OWNER TO postgres;

--
-- TOC entry 4191 (class 0 OID 0)
-- Dependencies: 271
-- Name: superadmins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.superadmins_id_seq OWNED BY public.superadmins.id;


--
-- TOC entry 284 (class 1259 OID 17194)
-- Name: tokens_recuperacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tokens_recuperacion (
    id integer NOT NULL,
    usuario_id integer NOT NULL,
    token_hash text NOT NULL,
    expira_en timestamp with time zone NOT NULL,
    usado boolean DEFAULT false NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tokens_recuperacion OWNER TO postgres;

--
-- TOC entry 283 (class 1259 OID 17193)
-- Name: tokens_recuperacion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tokens_recuperacion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tokens_recuperacion_id_seq OWNER TO postgres;

--
-- TOC entry 4192 (class 0 OID 0)
-- Dependencies: 283
-- Name: tokens_recuperacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tokens_recuperacion_id_seq OWNED BY public.tokens_recuperacion.id;


--
-- TOC entry 296 (class 1259 OID 17425)
-- Name: traslados; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.traslados (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    sucursal_origen_id integer NOT NULL,
    sucursal_destino_id integer NOT NULL,
    usuario_id integer,
    notas text,
    estado character varying(20) DEFAULT 'Completado'::character varying NOT NULL,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_traslado_estado CHECK (((estado)::text = ANY ((ARRAY['Completado'::character varying, 'Cancelado'::character varying])::text[]))),
    CONSTRAINT chk_traslado_sucursales_distintas CHECK ((sucursal_origen_id <> sucursal_destino_id))
);


ALTER TABLE public.traslados OWNER TO postgres;

--
-- TOC entry 295 (class 1259 OID 17424)
-- Name: traslados_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.traslados_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.traslados_id_seq OWNER TO postgres;

--
-- TOC entry 4193 (class 0 OID 0)
-- Dependencies: 295
-- Name: traslados_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.traslados_id_seq OWNED BY public.traslados.id;


--
-- TOC entry 272 (class 1259 OID 16646)
-- Name: usuarios; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    negocio_id integer NOT NULL,
    sucursal_id integer,
    nombre character varying(100) NOT NULL,
    email character varying(150) NOT NULL,
    password_hash text NOT NULL,
    rol public.rol_usuario DEFAULT 'vendedor'::public.rol_usuario NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL,
    ultimo_acceso timestamp without time zone,
    password_temporal boolean DEFAULT false NOT NULL,
    modulos_permitidos text[],
    permisos_proveedores jsonb
);


ALTER TABLE public.usuarios OWNER TO postgres;

--
-- TOC entry 273 (class 1259 OID 16655)
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.usuarios_id_seq OWNER TO postgres;

--
-- TOC entry 4194 (class 0 OID 0)
-- Dependencies: 273
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- TOC entry 3526 (class 2604 OID 16656)
-- Name: abonos_credito id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_credito ALTER COLUMN id SET DEFAULT nextval('public.abonos_credito_id_seq'::regclass);


--
-- TOC entry 3654 (class 2604 OID 17288)
-- Name: abonos_domicilio id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_domicilio ALTER COLUMN id SET DEFAULT nextval('public.abonos_domicilio_id_seq'::regclass);


--
-- TOC entry 3529 (class 2604 OID 16657)
-- Name: abonos_prestamo id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_prestamo ALTER COLUMN id SET DEFAULT nextval('public.abonos_prestamo_id_seq'::regclass);


--
-- TOC entry 3662 (class 2604 OID 17372)
-- Name: abonos_servicio id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_servicio ALTER COLUMN id SET DEFAULT nextval('public.abonos_servicio_id_seq'::regclass);


--
-- TOC entry 3532 (class 2604 OID 16658)
-- Name: acreedores id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acreedores ALTER COLUMN id SET DEFAULT nextval('public.acreedores_id_seq'::regclass);


--
-- TOC entry 3534 (class 2604 OID 16659)
-- Name: aperturas_caja id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.aperturas_caja ALTER COLUMN id SET DEFAULT nextval('public.aperturas_caja_id_seq'::regclass);


--
-- TOC entry 3538 (class 2604 OID 16660)
-- Name: auditoria id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria ALTER COLUMN id SET DEFAULT nextval('public.auditoria_id_seq'::regclass);


--
-- TOC entry 3540 (class 2604 OID 16661)
-- Name: clientes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes ALTER COLUMN id SET DEFAULT nextval('public.clientes_id_seq'::regclass);


--
-- TOC entry 3670 (class 2604 OID 17525)
-- Name: clientes_frecuentes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes_frecuentes ALTER COLUMN id SET DEFAULT nextval('public.clientes_frecuentes_id_seq'::regclass);


--
-- TOC entry 3543 (class 2604 OID 16662)
-- Name: compras id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compras ALTER COLUMN id SET DEFAULT nextval('public.compras_id_seq'::regclass);


--
-- TOC entry 3549 (class 2604 OID 16663)
-- Name: config_negocio id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.config_negocio ALTER COLUMN id SET DEFAULT nextval('public.config_negocio_id_seq'::regclass);


--
-- TOC entry 3551 (class 2604 OID 16664)
-- Name: creditos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.creditos ALTER COLUMN id SET DEFAULT nextval('public.creditos_id_seq'::regclass);


--
-- TOC entry 3647 (class 2604 OID 17224)
-- Name: domiciliarios id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.domiciliarios ALTER COLUMN id SET DEFAULT nextval('public.domiciliarios_id_seq'::regclass);


--
-- TOC entry 3637 (class 2604 OID 17042)
-- Name: empleados_prestatario id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.empleados_prestatario ALTER COLUMN id SET DEFAULT nextval('public.empleados_prestatario_id_seq'::regclass);


--
-- TOC entry 3650 (class 2604 OID 17249)
-- Name: entregas_domicilio id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entregas_domicilio ALTER COLUMN id SET DEFAULT nextval('public.entregas_domicilio_id_seq'::regclass);


--
-- TOC entry 3556 (class 2604 OID 16665)
-- Name: facturas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facturas ALTER COLUMN id SET DEFAULT nextval('public.facturas_id_seq'::regclass);


--
-- TOC entry 3560 (class 2604 OID 16666)
-- Name: garantias id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garantias ALTER COLUMN id SET DEFAULT nextval('public.garantias_id_seq'::regclass);


--
-- TOC entry 3639 (class 2604 OID 17079)
-- Name: historial_stock_cantidad id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_stock_cantidad ALTER COLUMN id SET DEFAULT nextval('public.historial_stock_cantidad_id_seq'::regclass);


--
-- TOC entry 3562 (class 2604 OID 16667)
-- Name: lineas_compra id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_compra ALTER COLUMN id SET DEFAULT nextval('public.lineas_compra_id_seq'::regclass);


--
-- TOC entry 3565 (class 2604 OID 16668)
-- Name: lineas_factura id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_factura ALTER COLUMN id SET DEFAULT nextval('public.lineas_factura_id_seq'::regclass);


--
-- TOC entry 3642 (class 2604 OID 17126)
-- Name: lineas_producto id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_producto ALTER COLUMN id SET DEFAULT nextval('public.lineas_producto_id_seq'::regclass);


--
-- TOC entry 3668 (class 2604 OID 17461)
-- Name: lineas_traslado id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_traslado ALTER COLUMN id SET DEFAULT nextval('public.lineas_traslado_id_seq'::regclass);


--
-- TOC entry 3568 (class 2604 OID 16669)
-- Name: movimientos_acreedor id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_acreedor ALTER COLUMN id SET DEFAULT nextval('public.movimientos_acreedor_id_seq'::regclass);


--
-- TOC entry 3572 (class 2604 OID 16670)
-- Name: movimientos_caja id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_caja ALTER COLUMN id SET DEFAULT nextval('public.movimientos_caja_id_seq'::regclass);


--
-- TOC entry 3672 (class 2604 OID 17774)
-- Name: movimientos_prestatario id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_prestatario ALTER COLUMN id SET DEFAULT nextval('public.movimientos_prestatario_id_seq'::regclass);


--
-- TOC entry 3575 (class 2604 OID 16671)
-- Name: negocios id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.negocios ALTER COLUMN id SET DEFAULT nextval('public.negocios_id_seq'::regclass);


--
-- TOC entry 3656 (class 2604 OID 17332)
-- Name: ordenes_servicio id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_servicio ALTER COLUMN id SET DEFAULT nextval('public.ordenes_servicio_id_seq'::regclass);


--
-- TOC entry 3584 (class 2604 OID 16672)
-- Name: pagos_factura id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pagos_factura ALTER COLUMN id SET DEFAULT nextval('public.pagos_factura_id_seq'::regclass);


--
-- TOC entry 3585 (class 2604 OID 16673)
-- Name: pagos_plan id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pagos_plan ALTER COLUMN id SET DEFAULT nextval('public.pagos_plan_id_seq'::regclass);


--
-- TOC entry 3589 (class 2604 OID 16674)
-- Name: planes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planes ALTER COLUMN id SET DEFAULT nextval('public.planes_id_seq'::regclass);


--
-- TOC entry 3593 (class 2604 OID 16675)
-- Name: prestamos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestamos ALTER COLUMN id SET DEFAULT nextval('public.prestamos_id_seq'::regclass);


--
-- TOC entry 3633 (class 2604 OID 17029)
-- Name: prestatarios id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestatarios ALTER COLUMN id SET DEFAULT nextval('public.prestatarios_id_seq'::regclass);


--
-- TOC entry 3598 (class 2604 OID 16676)
-- Name: productos_cantidad id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_cantidad ALTER COLUMN id SET DEFAULT nextval('public.productos_cantidad_id_seq'::regclass);


--
-- TOC entry 3604 (class 2604 OID 16677)
-- Name: productos_serial id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_serial ALTER COLUMN id SET DEFAULT nextval('public.productos_serial_id_seq'::regclass);


--
-- TOC entry 3607 (class 2604 OID 16678)
-- Name: proveedores id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores ALTER COLUMN id SET DEFAULT nextval('public.proveedores_id_seq'::regclass);


--
-- TOC entry 3611 (class 2604 OID 16679)
-- Name: retomas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retomas ALTER COLUMN id SET DEFAULT nextval('public.retomas_id_seq'::regclass);


--
-- TOC entry 3617 (class 2604 OID 16680)
-- Name: seriales id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seriales ALTER COLUMN id SET DEFAULT nextval('public.seriales_id_seq'::regclass);


--
-- TOC entry 3622 (class 2604 OID 16681)
-- Name: sucursales id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sucursales ALTER COLUMN id SET DEFAULT nextval('public.sucursales_id_seq'::regclass);


--
-- TOC entry 3625 (class 2604 OID 16682)
-- Name: superadmins id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.superadmins ALTER COLUMN id SET DEFAULT nextval('public.superadmins_id_seq'::regclass);


--
-- TOC entry 3644 (class 2604 OID 17197)
-- Name: tokens_recuperacion id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens_recuperacion ALTER COLUMN id SET DEFAULT nextval('public.tokens_recuperacion_id_seq'::regclass);


--
-- TOC entry 3665 (class 2604 OID 17428)
-- Name: traslados id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.traslados ALTER COLUMN id SET DEFAULT nextval('public.traslados_id_seq'::regclass);


--
-- TOC entry 3628 (class 2604 OID 16683)
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- TOC entry 3699 (class 2606 OID 16688)
-- Name: abonos_credito abonos_credito_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_credito
    ADD CONSTRAINT abonos_credito_pkey PRIMARY KEY (id);


--
-- TOC entry 3868 (class 2606 OID 17294)
-- Name: abonos_domicilio abonos_domicilio_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_domicilio
    ADD CONSTRAINT abonos_domicilio_pkey PRIMARY KEY (id);


--
-- TOC entry 3703 (class 2606 OID 16690)
-- Name: abonos_prestamo abonos_prestamo_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_prestamo
    ADD CONSTRAINT abonos_prestamo_pkey PRIMARY KEY (id);


--
-- TOC entry 3880 (class 2606 OID 17379)
-- Name: abonos_servicio abonos_servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_servicio
    ADD CONSTRAINT abonos_servicio_pkey PRIMARY KEY (id);


--
-- TOC entry 3707 (class 2606 OID 16692)
-- Name: acreedores acreedores_negocio_id_cedula_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acreedores
    ADD CONSTRAINT acreedores_negocio_id_cedula_key UNIQUE (negocio_id, cedula);


--
-- TOC entry 3709 (class 2606 OID 16694)
-- Name: acreedores acreedores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acreedores
    ADD CONSTRAINT acreedores_pkey PRIMARY KEY (id);


--
-- TOC entry 3713 (class 2606 OID 16696)
-- Name: aperturas_caja aperturas_caja_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.aperturas_caja
    ADD CONSTRAINT aperturas_caja_pkey PRIMARY KEY (id);


--
-- TOC entry 3716 (class 2606 OID 16698)
-- Name: auditoria auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_pkey PRIMARY KEY (id);


--
-- TOC entry 3892 (class 2606 OID 17528)
-- Name: clientes_frecuentes clientes_frecuentes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes_frecuentes
    ADD CONSTRAINT clientes_frecuentes_pkey PRIMARY KEY (id);


--
-- TOC entry 3720 (class 2606 OID 16700)
-- Name: clientes clientes_negocio_id_cedula_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_negocio_id_cedula_key UNIQUE (negocio_id, cedula);


--
-- TOC entry 3722 (class 2606 OID 16702)
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- TOC entry 3725 (class 2606 OID 16704)
-- Name: compras compras_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_pkey PRIMARY KEY (id);


--
-- TOC entry 3729 (class 2606 OID 16706)
-- Name: config_negocio config_negocio_negocio_id_clave_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.config_negocio
    ADD CONSTRAINT config_negocio_negocio_id_clave_key UNIQUE (negocio_id, clave);


--
-- TOC entry 3731 (class 2606 OID 16708)
-- Name: config_negocio config_negocio_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.config_negocio
    ADD CONSTRAINT config_negocio_pkey PRIMARY KEY (id);


--
-- TOC entry 3734 (class 2606 OID 16710)
-- Name: creditos creditos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.creditos
    ADD CONSTRAINT creditos_pkey PRIMARY KEY (id);


--
-- TOC entry 3855 (class 2606 OID 17230)
-- Name: domiciliarios domiciliarios_nombre_negocio_uq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.domiciliarios
    ADD CONSTRAINT domiciliarios_nombre_negocio_uq UNIQUE (negocio_id, nombre);


--
-- TOC entry 3857 (class 2606 OID 17228)
-- Name: domiciliarios domiciliarios_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.domiciliarios
    ADD CONSTRAINT domiciliarios_pkey PRIMARY KEY (id);


--
-- TOC entry 3835 (class 2606 OID 17045)
-- Name: empleados_prestatario empleados_prestatario_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.empleados_prestatario
    ADD CONSTRAINT empleados_prestatario_pkey PRIMARY KEY (id);


--
-- TOC entry 3860 (class 2606 OID 17259)
-- Name: entregas_domicilio entregas_domicilio_factura_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entregas_domicilio
    ADD CONSTRAINT entregas_domicilio_factura_id_key UNIQUE (factura_id);


--
-- TOC entry 3862 (class 2606 OID 17257)
-- Name: entregas_domicilio entregas_domicilio_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entregas_domicilio
    ADD CONSTRAINT entregas_domicilio_pkey PRIMARY KEY (id);


--
-- TOC entry 3739 (class 2606 OID 16712)
-- Name: facturas facturas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_pkey PRIMARY KEY (id);


--
-- TOC entry 3849 (class 2606 OID 17151)
-- Name: garantias_lineas garantias_lineas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garantias_lineas
    ADD CONSTRAINT garantias_lineas_pkey PRIMARY KEY (garantia_id, linea_id);


--
-- TOC entry 3745 (class 2606 OID 16714)
-- Name: garantias garantias_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garantias
    ADD CONSTRAINT garantias_pkey PRIMARY KEY (id);


--
-- TOC entry 3838 (class 2606 OID 17085)
-- Name: historial_stock_cantidad historial_stock_cantidad_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_stock_cantidad
    ADD CONSTRAINT historial_stock_cantidad_pkey PRIMARY KEY (id);


--
-- TOC entry 3749 (class 2606 OID 16716)
-- Name: lineas_compra lineas_compra_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_compra
    ADD CONSTRAINT lineas_compra_pkey PRIMARY KEY (id);


--
-- TOC entry 3752 (class 2606 OID 16718)
-- Name: lineas_factura lineas_factura_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_factura
    ADD CONSTRAINT lineas_factura_pkey PRIMARY KEY (id);


--
-- TOC entry 3845 (class 2606 OID 17131)
-- Name: lineas_producto lineas_producto_negocio_id_nombre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_producto
    ADD CONSTRAINT lineas_producto_negocio_id_nombre_key UNIQUE (negocio_id, nombre);


--
-- TOC entry 3847 (class 2606 OID 17129)
-- Name: lineas_producto lineas_producto_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_producto
    ADD CONSTRAINT lineas_producto_pkey PRIMARY KEY (id);


--
-- TOC entry 3890 (class 2606 OID 17464)
-- Name: lineas_traslado lineas_traslado_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_traslado
    ADD CONSTRAINT lineas_traslado_pkey PRIMARY KEY (id);


--
-- TOC entry 3758 (class 2606 OID 16720)
-- Name: movimientos_acreedor movimientos_acreedor_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_acreedor
    ADD CONSTRAINT movimientos_acreedor_pkey PRIMARY KEY (id);


--
-- TOC entry 3762 (class 2606 OID 16722)
-- Name: movimientos_caja movimientos_caja_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_caja
    ADD CONSTRAINT movimientos_caja_pkey PRIMARY KEY (id);


--
-- TOC entry 3901 (class 2606 OID 17786)
-- Name: movimientos_prestatario movimientos_prestatario_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_prestatario
    ADD CONSTRAINT movimientos_prestatario_pkey PRIMARY KEY (id);


--
-- TOC entry 3766 (class 2606 OID 16724)
-- Name: negocios negocios_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.negocios
    ADD CONSTRAINT negocios_email_key UNIQUE (email);


--
-- TOC entry 3768 (class 2606 OID 16726)
-- Name: negocios negocios_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.negocios
    ADD CONSTRAINT negocios_pkey PRIMARY KEY (id);


--
-- TOC entry 3878 (class 2606 OID 17342)
-- Name: ordenes_servicio ordenes_servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_servicio
    ADD CONSTRAINT ordenes_servicio_pkey PRIMARY KEY (id);


--
-- TOC entry 3771 (class 2606 OID 16728)
-- Name: pagos_factura pagos_factura_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pagos_factura
    ADD CONSTRAINT pagos_factura_pkey PRIMARY KEY (id);


--
-- TOC entry 3774 (class 2606 OID 16730)
-- Name: pagos_plan pagos_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pagos_plan
    ADD CONSTRAINT pagos_plan_pkey PRIMARY KEY (id);


--
-- TOC entry 3776 (class 2606 OID 16732)
-- Name: planes planes_nombre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planes
    ADD CONSTRAINT planes_nombre_key UNIQUE (nombre);


--
-- TOC entry 3778 (class 2606 OID 16734)
-- Name: planes planes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planes
    ADD CONSTRAINT planes_pkey PRIMARY KEY (id);


--
-- TOC entry 3782 (class 2606 OID 16736)
-- Name: prestamos prestamos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestamos
    ADD CONSTRAINT prestamos_pkey PRIMARY KEY (id);


--
-- TOC entry 3833 (class 2606 OID 17032)
-- Name: prestatarios prestatarios_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestatarios
    ADD CONSTRAINT prestatarios_pkey PRIMARY KEY (id);


--
-- TOC entry 3786 (class 2606 OID 16738)
-- Name: productos_cantidad productos_cantidad_nombre_sucursal_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_cantidad
    ADD CONSTRAINT productos_cantidad_nombre_sucursal_id_key UNIQUE (nombre, sucursal_id);


--
-- TOC entry 3788 (class 2606 OID 16740)
-- Name: productos_cantidad productos_cantidad_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_cantidad
    ADD CONSTRAINT productos_cantidad_pkey PRIMARY KEY (id);


--
-- TOC entry 3792 (class 2606 OID 16742)
-- Name: productos_serial productos_serial_nombre_sucursal_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_serial
    ADD CONSTRAINT productos_serial_nombre_sucursal_id_key UNIQUE (nombre, sucursal_id);


--
-- TOC entry 3794 (class 2606 OID 16744)
-- Name: productos_serial productos_serial_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_serial
    ADD CONSTRAINT productos_serial_pkey PRIMARY KEY (id);


--
-- TOC entry 3798 (class 2606 OID 16746)
-- Name: proveedores proveedores_negocio_id_nombre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_negocio_id_nombre_key UNIQUE (negocio_id, nombre);


--
-- TOC entry 3800 (class 2606 OID 16748)
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- TOC entry 3805 (class 2606 OID 16750)
-- Name: retomas retomas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retomas
    ADD CONSTRAINT retomas_pkey PRIMARY KEY (id);


--
-- TOC entry 3811 (class 2606 OID 17009)
-- Name: seriales seriales_imei_negocio_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seriales
    ADD CONSTRAINT seriales_imei_negocio_unique UNIQUE (imei, producto_id);


--
-- TOC entry 3813 (class 2606 OID 16754)
-- Name: seriales seriales_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seriales
    ADD CONSTRAINT seriales_pkey PRIMARY KEY (id);


--
-- TOC entry 3816 (class 2606 OID 16756)
-- Name: sucursales sucursales_negocio_id_nombre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_negocio_id_nombre_key UNIQUE (negocio_id, nombre);


--
-- TOC entry 3818 (class 2606 OID 16758)
-- Name: sucursales sucursales_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_pkey PRIMARY KEY (id);


--
-- TOC entry 3820 (class 2606 OID 16760)
-- Name: superadmins superadmins_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.superadmins
    ADD CONSTRAINT superadmins_email_key UNIQUE (email);


--
-- TOC entry 3822 (class 2606 OID 16762)
-- Name: superadmins superadmins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.superadmins
    ADD CONSTRAINT superadmins_pkey PRIMARY KEY (id);


--
-- TOC entry 3853 (class 2606 OID 17203)
-- Name: tokens_recuperacion tokens_recuperacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens_recuperacion
    ADD CONSTRAINT tokens_recuperacion_pkey PRIMARY KEY (id);


--
-- TOC entry 3887 (class 2606 OID 17436)
-- Name: traslados traslados_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.traslados
    ADD CONSTRAINT traslados_pkey PRIMARY KEY (id);


--
-- TOC entry 3895 (class 2606 OID 17530)
-- Name: clientes_frecuentes uq_cliente_frecuente_sucursal; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes_frecuentes
    ADD CONSTRAINT uq_cliente_frecuente_sucursal UNIQUE (sucursal_id, cliente_id);


--
-- TOC entry 3828 (class 2606 OID 17017)
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- TOC entry 3830 (class 2606 OID 16766)
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- TOC entry 3700 (class 1259 OID 17504)
-- Name: idx_abonos_credito_credito; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_abonos_credito_credito ON public.abonos_credito USING btree (credito_id);


--
-- TOC entry 3701 (class 1259 OID 17505)
-- Name: idx_abonos_credito_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_abonos_credito_fecha ON public.abonos_credito USING btree (fecha);


--
-- TOC entry 3869 (class 1259 OID 17310)
-- Name: idx_abonos_entrega; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_abonos_entrega ON public.abonos_domicilio USING btree (entrega_id);


--
-- TOC entry 3870 (class 1259 OID 17311)
-- Name: idx_abonos_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_abonos_negocio ON public.abonos_domicilio USING btree (negocio_id);


--
-- TOC entry 3704 (class 1259 OID 17507)
-- Name: idx_abonos_prestamo_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_abonos_prestamo_fecha ON public.abonos_prestamo USING btree (fecha);


--
-- TOC entry 3705 (class 1259 OID 17177)
-- Name: idx_abonos_prestamo_prestamo_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_abonos_prestamo_prestamo_id ON public.abonos_prestamo USING btree (prestamo_id);


--
-- TOC entry 3881 (class 1259 OID 17506)
-- Name: idx_abonos_servicio_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_abonos_servicio_fecha ON public.abonos_servicio USING btree (fecha);


--
-- TOC entry 3882 (class 1259 OID 17394)
-- Name: idx_abonos_servicio_orden; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_abonos_servicio_orden ON public.abonos_servicio USING btree (orden_id);


--
-- TOC entry 3710 (class 1259 OID 16767)
-- Name: idx_acreedores_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acreedores_negocio ON public.acreedores USING btree (negocio_id);


--
-- TOC entry 3711 (class 1259 OID 17023)
-- Name: idx_acreedores_proveedor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acreedores_proveedor ON public.acreedores USING btree (proveedor_id);


--
-- TOC entry 3714 (class 1259 OID 17113)
-- Name: idx_aperturas_caja_sucursal_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_aperturas_caja_sucursal_estado ON public.aperturas_caja USING btree (sucursal_id, estado);


--
-- TOC entry 3717 (class 1259 OID 16768)
-- Name: idx_auditoria_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_auditoria_fecha ON public.auditoria USING btree (fecha);


--
-- TOC entry 3718 (class 1259 OID 16769)
-- Name: idx_auditoria_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_auditoria_negocio ON public.auditoria USING btree (negocio_id);


--
-- TOC entry 3893 (class 1259 OID 17541)
-- Name: idx_clientes_frecuentes_sucursal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_clientes_frecuentes_sucursal ON public.clientes_frecuentes USING btree (sucursal_id);


--
-- TOC entry 3723 (class 1259 OID 16772)
-- Name: idx_clientes_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_clientes_negocio ON public.clientes USING btree (negocio_id);


--
-- TOC entry 3726 (class 1259 OID 17502)
-- Name: idx_compras_proveedor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_compras_proveedor ON public.compras USING btree (proveedor_id);


--
-- TOC entry 3727 (class 1259 OID 17501)
-- Name: idx_compras_sucursal_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_compras_sucursal_fecha ON public.compras USING btree (sucursal_id, fecha DESC);


--
-- TOC entry 3732 (class 1259 OID 16773)
-- Name: idx_config_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_config_negocio ON public.config_negocio USING btree (negocio_id);


--
-- TOC entry 3735 (class 1259 OID 16774)
-- Name: idx_creditos_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_creditos_estado ON public.creditos USING btree (estado);


--
-- TOC entry 3736 (class 1259 OID 17509)
-- Name: idx_creditos_factura; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_creditos_factura ON public.creditos USING btree (factura_id);


--
-- TOC entry 3737 (class 1259 OID 17508)
-- Name: idx_creditos_sucursal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_creditos_sucursal ON public.creditos USING btree (sucursal_id);


--
-- TOC entry 3858 (class 1259 OID 17236)
-- Name: idx_domiciliarios_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_domiciliarios_negocio ON public.domiciliarios USING btree (negocio_id);


--
-- TOC entry 3836 (class 1259 OID 17517)
-- Name: idx_empleados_prestatario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_empleados_prestatario ON public.empleados_prestatario USING btree (prestatario_id);


--
-- TOC entry 3863 (class 1259 OID 17281)
-- Name: idx_entregas_domiciliario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_entregas_domiciliario ON public.entregas_domicilio USING btree (domiciliario_id);


--
-- TOC entry 3864 (class 1259 OID 17282)
-- Name: idx_entregas_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_entregas_estado ON public.entregas_domicilio USING btree (estado);


--
-- TOC entry 3865 (class 1259 OID 17283)
-- Name: idx_entregas_factura; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_entregas_factura ON public.entregas_domicilio USING btree (factura_id);


--
-- TOC entry 3866 (class 1259 OID 17280)
-- Name: idx_entregas_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_entregas_negocio ON public.entregas_domicilio USING btree (negocio_id);


--
-- TOC entry 3740 (class 1259 OID 16775)
-- Name: idx_facturas_cedula; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_facturas_cedula ON public.facturas USING btree (cedula);


--
-- TOC entry 3741 (class 1259 OID 16776)
-- Name: idx_facturas_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_facturas_fecha ON public.facturas USING btree (fecha);


--
-- TOC entry 3742 (class 1259 OID 16777)
-- Name: idx_facturas_sucursal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_facturas_sucursal ON public.facturas USING btree (sucursal_id);


--
-- TOC entry 3743 (class 1259 OID 17174)
-- Name: idx_facturas_sucursal_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_facturas_sucursal_fecha ON public.facturas USING btree (sucursal_id, fecha DESC);


--
-- TOC entry 3746 (class 1259 OID 16778)
-- Name: idx_garantias_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_garantias_negocio ON public.garantias USING btree (negocio_id);


--
-- TOC entry 3839 (class 1259 OID 17104)
-- Name: idx_historial_stock_cliente; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_historial_stock_cliente ON public.historial_stock_cantidad USING btree (cliente_origen);


--
-- TOC entry 3840 (class 1259 OID 17105)
-- Name: idx_historial_stock_creado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_historial_stock_creado ON public.historial_stock_cantidad USING btree (creado_en DESC);


--
-- TOC entry 3841 (class 1259 OID 17101)
-- Name: idx_historial_stock_producto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_historial_stock_producto ON public.historial_stock_cantidad USING btree (producto_id);


--
-- TOC entry 3842 (class 1259 OID 17102)
-- Name: idx_historial_stock_sucursal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_historial_stock_sucursal ON public.historial_stock_cantidad USING btree (sucursal_id);


--
-- TOC entry 3843 (class 1259 OID 17103)
-- Name: idx_historial_stock_tipo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_historial_stock_tipo ON public.historial_stock_cantidad USING btree (tipo);


--
-- TOC entry 3747 (class 1259 OID 17503)
-- Name: idx_lineas_compra_compra; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lineas_compra_compra ON public.lineas_compra USING btree (compra_id);


--
-- TOC entry 3750 (class 1259 OID 17114)
-- Name: idx_lineas_factura_factura_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lineas_factura_factura_id ON public.lineas_factura USING btree (factura_id);


--
-- TOC entry 3888 (class 1259 OID 17498)
-- Name: idx_lineas_traslado_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lineas_traslado_id ON public.lineas_traslado USING btree (traslado_id);


--
-- TOC entry 3753 (class 1259 OID 16779)
-- Name: idx_mov_acreedor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mov_acreedor ON public.movimientos_acreedor USING btree (acreedor_id);


--
-- TOC entry 3754 (class 1259 OID 17511)
-- Name: idx_mov_acreedor_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mov_acreedor_fecha ON public.movimientos_acreedor USING btree (fecha);


--
-- TOC entry 3755 (class 1259 OID 17512)
-- Name: idx_mov_acreedor_tipo_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mov_acreedor_tipo_fecha ON public.movimientos_acreedor USING btree (tipo, fecha);


--
-- TOC entry 3759 (class 1259 OID 16780)
-- Name: idx_mov_caja; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mov_caja ON public.movimientos_caja USING btree (caja_id);


--
-- TOC entry 3760 (class 1259 OID 17513)
-- Name: idx_mov_caja_ref_tipo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mov_caja_ref_tipo ON public.movimientos_caja USING btree (caja_id, referencia_tipo);


--
-- TOC entry 3756 (class 1259 OID 17167)
-- Name: idx_movimientos_acreedor_compra_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_movimientos_acreedor_compra_id ON public.movimientos_acreedor USING btree (compra_id);


--
-- TOC entry 3896 (class 1259 OID 17820)
-- Name: idx_movpre_anulado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_movpre_anulado ON public.movimientos_prestatario USING btree (anulado) WHERE (NOT anulado);


--
-- TOC entry 3897 (class 1259 OID 17818)
-- Name: idx_movpre_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_movpre_fecha ON public.movimientos_prestatario USING btree (fecha DESC);


--
-- TOC entry 3898 (class 1259 OID 17817)
-- Name: idx_movpre_prestatario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_movpre_prestatario ON public.movimientos_prestatario USING btree (prestatario_id);


--
-- TOC entry 3899 (class 1259 OID 17819)
-- Name: idx_movpre_sucursal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_movpre_sucursal ON public.movimientos_prestatario USING btree (sucursal_id);


--
-- TOC entry 3763 (class 1259 OID 16781)
-- Name: idx_negocios_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_negocios_estado ON public.negocios USING btree (estado_plan);


--
-- TOC entry 3764 (class 1259 OID 16782)
-- Name: idx_negocios_vencimiento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_negocios_vencimiento ON public.negocios USING btree (fecha_vencimiento);


--
-- TOC entry 3871 (class 1259 OID 17392)
-- Name: idx_ordenes_servicio_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ordenes_servicio_estado ON public.ordenes_servicio USING btree (estado);


--
-- TOC entry 3872 (class 1259 OID 17393)
-- Name: idx_ordenes_servicio_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ordenes_servicio_fecha ON public.ordenes_servicio USING btree (fecha_recepcion);


--
-- TOC entry 3873 (class 1259 OID 17397)
-- Name: idx_ordenes_servicio_garantia; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ordenes_servicio_garantia ON public.ordenes_servicio USING btree (negocio_id) WHERE ((estado)::text = 'Garantia'::text);


--
-- TOC entry 3874 (class 1259 OID 17391)
-- Name: idx_ordenes_servicio_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ordenes_servicio_negocio ON public.ordenes_servicio USING btree (negocio_id);


--
-- TOC entry 3875 (class 1259 OID 17390)
-- Name: idx_ordenes_servicio_sucursal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ordenes_servicio_sucursal ON public.ordenes_servicio USING btree (sucursal_id);


--
-- TOC entry 3876 (class 1259 OID 17516)
-- Name: idx_ordenes_servicio_sucursal_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ordenes_servicio_sucursal_estado ON public.ordenes_servicio USING btree (sucursal_id, estado);


--
-- TOC entry 3769 (class 1259 OID 17175)
-- Name: idx_pagos_factura_factura_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pagos_factura_factura_id ON public.pagos_factura USING btree (factura_id);


--
-- TOC entry 3772 (class 1259 OID 17520)
-- Name: idx_pagos_plan_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pagos_plan_negocio ON public.pagos_plan USING btree (negocio_id);


--
-- TOC entry 3779 (class 1259 OID 16783)
-- Name: idx_prestamos_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_prestamos_estado ON public.prestamos USING btree (estado);


--
-- TOC entry 3780 (class 1259 OID 17510)
-- Name: idx_prestamos_sucursal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_prestamos_sucursal ON public.prestamos USING btree (sucursal_id);


--
-- TOC entry 3831 (class 1259 OID 17518)
-- Name: idx_prestatarios_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_prestatarios_negocio ON public.prestatarios USING btree (negocio_id);


--
-- TOC entry 3783 (class 1259 OID 17514)
-- Name: idx_productos_cant_linea; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_productos_cant_linea ON public.productos_cantidad USING btree (linea_id) WHERE (activo = true);


--
-- TOC entry 3784 (class 1259 OID 16784)
-- Name: idx_productos_cant_suc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_productos_cant_suc ON public.productos_cantidad USING btree (sucursal_id);


--
-- TOC entry 3789 (class 1259 OID 17515)
-- Name: idx_productos_serial_linea; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_productos_serial_linea ON public.productos_serial USING btree (linea_id);


--
-- TOC entry 3790 (class 1259 OID 16785)
-- Name: idx_productos_serial_suc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_productos_serial_suc ON public.productos_serial USING btree (sucursal_id);


--
-- TOC entry 3795 (class 1259 OID 16786)
-- Name: idx_proveedores_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_proveedores_negocio ON public.proveedores USING btree (negocio_id);


--
-- TOC entry 3796 (class 1259 OID 17403)
-- Name: idx_proveedores_negocio_tipo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_proveedores_negocio_tipo ON public.proveedores USING btree (negocio_id, tipo) WHERE (activo = true);


--
-- TOC entry 3801 (class 1259 OID 17176)
-- Name: idx_retomas_factura_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_retomas_factura_id ON public.retomas USING btree (factura_id);


--
-- TOC entry 3802 (class 1259 OID 17519)
-- Name: idx_retomas_imei; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_retomas_imei ON public.retomas USING btree (imei) WHERE (imei IS NOT NULL);


--
-- TOC entry 3803 (class 1259 OID 17766)
-- Name: idx_retomas_persona; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_retomas_persona ON public.retomas USING btree (tipo_persona, persona_id) WHERE (tipo_persona IS NOT NULL);


--
-- TOC entry 3806 (class 1259 OID 16787)
-- Name: idx_seriales_imei; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seriales_imei ON public.seriales USING btree (imei);


--
-- TOC entry 3807 (class 1259 OID 16788)
-- Name: idx_seriales_producto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seriales_producto ON public.seriales USING btree (producto_id);


--
-- TOC entry 3808 (class 1259 OID 17072)
-- Name: idx_seriales_proveedor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seriales_proveedor ON public.seriales USING btree (proveedor_id);


--
-- TOC entry 3809 (class 1259 OID 16789)
-- Name: idx_seriales_vendido; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_seriales_vendido ON public.seriales USING btree (vendido);


--
-- TOC entry 3814 (class 1259 OID 16790)
-- Name: idx_sucursales_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sucursales_negocio ON public.sucursales USING btree (negocio_id);


--
-- TOC entry 3850 (class 1259 OID 17209)
-- Name: idx_tokens_recuperacion_token_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tokens_recuperacion_token_hash ON public.tokens_recuperacion USING btree (token_hash);


--
-- TOC entry 3851 (class 1259 OID 17210)
-- Name: idx_tokens_recuperacion_usuario_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tokens_recuperacion_usuario_id ON public.tokens_recuperacion USING btree (usuario_id);


--
-- TOC entry 3883 (class 1259 OID 17497)
-- Name: idx_traslados_destino; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_traslados_destino ON public.traslados USING btree (sucursal_destino_id, fecha DESC);


--
-- TOC entry 3884 (class 1259 OID 17495)
-- Name: idx_traslados_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_traslados_negocio ON public.traslados USING btree (negocio_id, fecha DESC);


--
-- TOC entry 3885 (class 1259 OID 17496)
-- Name: idx_traslados_origen; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_traslados_origen ON public.traslados USING btree (sucursal_origen_id, fecha DESC);


--
-- TOC entry 3823 (class 1259 OID 17112)
-- Name: idx_usuarios_email_lower; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_usuarios_email_lower ON public.usuarios USING btree (lower((email)::text));


--
-- TOC entry 3824 (class 1259 OID 17111)
-- Name: idx_usuarios_id_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_usuarios_id_negocio ON public.usuarios USING btree (id, negocio_id);


--
-- TOC entry 3825 (class 1259 OID 16791)
-- Name: idx_usuarios_negocio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_usuarios_negocio ON public.usuarios USING btree (negocio_id);


--
-- TOC entry 3826 (class 1259 OID 16792)
-- Name: idx_usuarios_sucursal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_usuarios_sucursal ON public.usuarios USING btree (sucursal_id);


--
-- TOC entry 3902 (class 2606 OID 16793)
-- Name: abonos_credito abonos_credito_credito_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_credito
    ADD CONSTRAINT abonos_credito_credito_id_fkey FOREIGN KEY (credito_id) REFERENCES public.creditos(id) ON DELETE CASCADE;


--
-- TOC entry 3903 (class 2606 OID 16798)
-- Name: abonos_credito abonos_credito_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_credito
    ADD CONSTRAINT abonos_credito_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3973 (class 2606 OID 17295)
-- Name: abonos_domicilio abonos_domicilio_entrega_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_domicilio
    ADD CONSTRAINT abonos_domicilio_entrega_id_fkey FOREIGN KEY (entrega_id) REFERENCES public.entregas_domicilio(id) ON DELETE CASCADE;


--
-- TOC entry 3974 (class 2606 OID 17300)
-- Name: abonos_domicilio abonos_domicilio_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_domicilio
    ADD CONSTRAINT abonos_domicilio_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 3975 (class 2606 OID 17305)
-- Name: abonos_domicilio abonos_domicilio_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_domicilio
    ADD CONSTRAINT abonos_domicilio_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- TOC entry 3904 (class 2606 OID 16803)
-- Name: abonos_prestamo abonos_prestamo_prestamo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_prestamo
    ADD CONSTRAINT abonos_prestamo_prestamo_id_fkey FOREIGN KEY (prestamo_id) REFERENCES public.prestamos(id) ON DELETE CASCADE;


--
-- TOC entry 3905 (class 2606 OID 17756)
-- Name: abonos_prestamo abonos_prestamo_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_prestamo
    ADD CONSTRAINT abonos_prestamo_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- TOC entry 3982 (class 2606 OID 17380)
-- Name: abonos_servicio abonos_servicio_orden_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_servicio
    ADD CONSTRAINT abonos_servicio_orden_id_fkey FOREIGN KEY (orden_id) REFERENCES public.ordenes_servicio(id);


--
-- TOC entry 3983 (class 2606 OID 17385)
-- Name: abonos_servicio abonos_servicio_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.abonos_servicio
    ADD CONSTRAINT abonos_servicio_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3906 (class 2606 OID 16808)
-- Name: acreedores acreedores_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acreedores
    ADD CONSTRAINT acreedores_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id) ON DELETE CASCADE;


--
-- TOC entry 3907 (class 2606 OID 17018)
-- Name: acreedores acreedores_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acreedores
    ADD CONSTRAINT acreedores_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;


--
-- TOC entry 3908 (class 2606 OID 16813)
-- Name: aperturas_caja aperturas_caja_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.aperturas_caja
    ADD CONSTRAINT aperturas_caja_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id);


--
-- TOC entry 3909 (class 2606 OID 16818)
-- Name: aperturas_caja aperturas_caja_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.aperturas_caja
    ADD CONSTRAINT aperturas_caja_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3910 (class 2606 OID 16823)
-- Name: auditoria auditoria_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 3911 (class 2606 OID 16828)
-- Name: auditoria auditoria_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3994 (class 2606 OID 17536)
-- Name: clientes_frecuentes clientes_frecuentes_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes_frecuentes
    ADD CONSTRAINT clientes_frecuentes_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- TOC entry 3995 (class 2606 OID 17531)
-- Name: clientes_frecuentes clientes_frecuentes_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes_frecuentes
    ADD CONSTRAINT clientes_frecuentes_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id) ON DELETE CASCADE;


--
-- TOC entry 3912 (class 2606 OID 16833)
-- Name: clientes clientes_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id) ON DELETE CASCADE;


--
-- TOC entry 3913 (class 2606 OID 16838)
-- Name: compras compras_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- TOC entry 3914 (class 2606 OID 16843)
-- Name: compras compras_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id);


--
-- TOC entry 3915 (class 2606 OID 16848)
-- Name: compras compras_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3916 (class 2606 OID 16853)
-- Name: config_negocio config_negocio_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.config_negocio
    ADD CONSTRAINT config_negocio_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id) ON DELETE CASCADE;


--
-- TOC entry 3917 (class 2606 OID 16858)
-- Name: creditos creditos_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.creditos
    ADD CONSTRAINT creditos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- TOC entry 3918 (class 2606 OID 16863)
-- Name: creditos creditos_factura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.creditos
    ADD CONSTRAINT creditos_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES public.facturas(id);


--
-- TOC entry 3919 (class 2606 OID 16868)
-- Name: creditos creditos_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.creditos
    ADD CONSTRAINT creditos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id);


--
-- TOC entry 3968 (class 2606 OID 17231)
-- Name: domiciliarios domiciliarios_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.domiciliarios
    ADD CONSTRAINT domiciliarios_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id) ON DELETE CASCADE;


--
-- TOC entry 3960 (class 2606 OID 17046)
-- Name: empleados_prestatario empleados_prestatario_prestatario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.empleados_prestatario
    ADD CONSTRAINT empleados_prestatario_prestatario_id_fkey FOREIGN KEY (prestatario_id) REFERENCES public.prestatarios(id) ON DELETE CASCADE;


--
-- TOC entry 3969 (class 2606 OID 17265)
-- Name: entregas_domicilio entregas_domicilio_domiciliario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entregas_domicilio
    ADD CONSTRAINT entregas_domicilio_domiciliario_id_fkey FOREIGN KEY (domiciliario_id) REFERENCES public.domiciliarios(id);


--
-- TOC entry 3970 (class 2606 OID 17260)
-- Name: entregas_domicilio entregas_domicilio_factura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entregas_domicilio
    ADD CONSTRAINT entregas_domicilio_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES public.facturas(id) ON DELETE CASCADE;


--
-- TOC entry 3971 (class 2606 OID 17270)
-- Name: entregas_domicilio entregas_domicilio_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entregas_domicilio
    ADD CONSTRAINT entregas_domicilio_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 3972 (class 2606 OID 17275)
-- Name: entregas_domicilio entregas_domicilio_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entregas_domicilio
    ADD CONSTRAINT entregas_domicilio_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- TOC entry 3920 (class 2606 OID 16873)
-- Name: facturas facturas_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- TOC entry 3921 (class 2606 OID 16878)
-- Name: facturas facturas_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id);


--
-- TOC entry 3922 (class 2606 OID 16883)
-- Name: facturas facturas_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3965 (class 2606 OID 17152)
-- Name: garantias_lineas garantias_lineas_garantia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garantias_lineas
    ADD CONSTRAINT garantias_lineas_garantia_id_fkey FOREIGN KEY (garantia_id) REFERENCES public.garantias(id) ON DELETE CASCADE;


--
-- TOC entry 3966 (class 2606 OID 17157)
-- Name: garantias_lineas garantias_lineas_linea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garantias_lineas
    ADD CONSTRAINT garantias_lineas_linea_id_fkey FOREIGN KEY (linea_id) REFERENCES public.lineas_producto(id) ON DELETE CASCADE;


--
-- TOC entry 3923 (class 2606 OID 16888)
-- Name: garantias garantias_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.garantias
    ADD CONSTRAINT garantias_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id) ON DELETE CASCADE;


--
-- TOC entry 3961 (class 2606 OID 17086)
-- Name: historial_stock_cantidad historial_stock_cantidad_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_stock_cantidad
    ADD CONSTRAINT historial_stock_cantidad_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos_cantidad(id) ON DELETE CASCADE;


--
-- TOC entry 3962 (class 2606 OID 17096)
-- Name: historial_stock_cantidad historial_stock_cantidad_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_stock_cantidad
    ADD CONSTRAINT historial_stock_cantidad_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;


--
-- TOC entry 3963 (class 2606 OID 17091)
-- Name: historial_stock_cantidad historial_stock_cantidad_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historial_stock_cantidad
    ADD CONSTRAINT historial_stock_cantidad_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id) ON DELETE CASCADE;


--
-- TOC entry 3924 (class 2606 OID 16893)
-- Name: lineas_compra lineas_compra_compra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_compra
    ADD CONSTRAINT lineas_compra_compra_id_fkey FOREIGN KEY (compra_id) REFERENCES public.compras(id) ON DELETE CASCADE;


--
-- TOC entry 3925 (class 2606 OID 16898)
-- Name: lineas_factura lineas_factura_factura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_factura
    ADD CONSTRAINT lineas_factura_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES public.facturas(id) ON DELETE CASCADE;


--
-- TOC entry 3926 (class 2606 OID 17106)
-- Name: lineas_factura lineas_factura_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_factura
    ADD CONSTRAINT lineas_factura_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos_cantidad(id) ON DELETE SET NULL;


--
-- TOC entry 3964 (class 2606 OID 17132)
-- Name: lineas_producto lineas_producto_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_producto
    ADD CONSTRAINT lineas_producto_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id) ON DELETE CASCADE;


--
-- TOC entry 3988 (class 2606 OID 17490)
-- Name: lineas_traslado lineas_traslado_producto_cantidad_destino_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_traslado
    ADD CONSTRAINT lineas_traslado_producto_cantidad_destino_id_fkey FOREIGN KEY (producto_cantidad_destino_id) REFERENCES public.productos_cantidad(id);


--
-- TOC entry 3989 (class 2606 OID 17485)
-- Name: lineas_traslado lineas_traslado_producto_cantidad_origen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_traslado
    ADD CONSTRAINT lineas_traslado_producto_cantidad_origen_id_fkey FOREIGN KEY (producto_cantidad_origen_id) REFERENCES public.productos_cantidad(id);


--
-- TOC entry 3990 (class 2606 OID 17480)
-- Name: lineas_traslado lineas_traslado_producto_serial_destino_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_traslado
    ADD CONSTRAINT lineas_traslado_producto_serial_destino_id_fkey FOREIGN KEY (producto_serial_destino_id) REFERENCES public.productos_serial(id);


--
-- TOC entry 3991 (class 2606 OID 17475)
-- Name: lineas_traslado lineas_traslado_producto_serial_origen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_traslado
    ADD CONSTRAINT lineas_traslado_producto_serial_origen_id_fkey FOREIGN KEY (producto_serial_origen_id) REFERENCES public.productos_serial(id);


--
-- TOC entry 3992 (class 2606 OID 17470)
-- Name: lineas_traslado lineas_traslado_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_traslado
    ADD CONSTRAINT lineas_traslado_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.seriales(id);


--
-- TOC entry 3993 (class 2606 OID 17465)
-- Name: lineas_traslado lineas_traslado_traslado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lineas_traslado
    ADD CONSTRAINT lineas_traslado_traslado_id_fkey FOREIGN KEY (traslado_id) REFERENCES public.traslados(id) ON DELETE CASCADE;


--
-- TOC entry 3927 (class 2606 OID 16903)
-- Name: movimientos_acreedor movimientos_acreedor_acreedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_acreedor
    ADD CONSTRAINT movimientos_acreedor_acreedor_id_fkey FOREIGN KEY (acreedor_id) REFERENCES public.acreedores(id) ON DELETE CASCADE;


--
-- TOC entry 3928 (class 2606 OID 17727)
-- Name: movimientos_acreedor movimientos_acreedor_cargo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_acreedor
    ADD CONSTRAINT movimientos_acreedor_cargo_id_fkey FOREIGN KEY (cargo_id) REFERENCES public.movimientos_acreedor(id) ON DELETE SET NULL;


--
-- TOC entry 3929 (class 2606 OID 17162)
-- Name: movimientos_acreedor movimientos_acreedor_compra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_acreedor
    ADD CONSTRAINT movimientos_acreedor_compra_id_fkey FOREIGN KEY (compra_id) REFERENCES public.compras(id) ON DELETE SET NULL;


--
-- TOC entry 3930 (class 2606 OID 16908)
-- Name: movimientos_acreedor movimientos_acreedor_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_acreedor
    ADD CONSTRAINT movimientos_acreedor_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3931 (class 2606 OID 16913)
-- Name: movimientos_caja movimientos_caja_caja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_caja
    ADD CONSTRAINT movimientos_caja_caja_id_fkey FOREIGN KEY (caja_id) REFERENCES public.aperturas_caja(id);


--
-- TOC entry 3932 (class 2606 OID 16918)
-- Name: movimientos_caja movimientos_caja_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_caja
    ADD CONSTRAINT movimientos_caja_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3996 (class 2606 OID 17812)
-- Name: movimientos_prestatario movimientos_prestatario_anulado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_prestatario
    ADD CONSTRAINT movimientos_prestatario_anulado_por_fkey FOREIGN KEY (anulado_por) REFERENCES public.usuarios(id);


--
-- TOC entry 3997 (class 2606 OID 17787)
-- Name: movimientos_prestatario movimientos_prestatario_prestatario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_prestatario
    ADD CONSTRAINT movimientos_prestatario_prestatario_id_fkey FOREIGN KEY (prestatario_id) REFERENCES public.prestatarios(id) ON DELETE RESTRICT;


--
-- TOC entry 3998 (class 2606 OID 17807)
-- Name: movimientos_prestatario movimientos_prestatario_producto_cantidad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_prestatario
    ADD CONSTRAINT movimientos_prestatario_producto_cantidad_id_fkey FOREIGN KEY (producto_cantidad_id) REFERENCES public.productos_cantidad(id);


--
-- TOC entry 3999 (class 2606 OID 17802)
-- Name: movimientos_prestatario movimientos_prestatario_producto_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_prestatario
    ADD CONSTRAINT movimientos_prestatario_producto_serial_id_fkey FOREIGN KEY (producto_serial_id) REFERENCES public.productos_serial(id);


--
-- TOC entry 4000 (class 2606 OID 17792)
-- Name: movimientos_prestatario movimientos_prestatario_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_prestatario
    ADD CONSTRAINT movimientos_prestatario_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id);


--
-- TOC entry 4001 (class 2606 OID 17797)
-- Name: movimientos_prestatario movimientos_prestatario_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimientos_prestatario
    ADD CONSTRAINT movimientos_prestatario_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3976 (class 2606 OID 17358)
-- Name: ordenes_servicio ordenes_servicio_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_servicio
    ADD CONSTRAINT ordenes_servicio_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- TOC entry 3977 (class 2606 OID 17705)
-- Name: ordenes_servicio ordenes_servicio_factura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_servicio
    ADD CONSTRAINT ordenes_servicio_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES public.facturas(id) ON DELETE SET NULL;


--
-- TOC entry 3978 (class 2606 OID 17348)
-- Name: ordenes_servicio ordenes_servicio_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_servicio
    ADD CONSTRAINT ordenes_servicio_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 3979 (class 2606 OID 17363)
-- Name: ordenes_servicio ordenes_servicio_orden_origen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_servicio
    ADD CONSTRAINT ordenes_servicio_orden_origen_id_fkey FOREIGN KEY (orden_origen_id) REFERENCES public.ordenes_servicio(id);


--
-- TOC entry 3980 (class 2606 OID 17343)
-- Name: ordenes_servicio ordenes_servicio_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_servicio
    ADD CONSTRAINT ordenes_servicio_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id);


--
-- TOC entry 3981 (class 2606 OID 17353)
-- Name: ordenes_servicio ordenes_servicio_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordenes_servicio
    ADD CONSTRAINT ordenes_servicio_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3933 (class 2606 OID 16923)
-- Name: pagos_factura pagos_factura_factura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pagos_factura
    ADD CONSTRAINT pagos_factura_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES public.facturas(id) ON DELETE CASCADE;


--
-- TOC entry 3934 (class 2606 OID 16928)
-- Name: pagos_plan pagos_plan_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pagos_plan
    ADD CONSTRAINT pagos_plan_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 3935 (class 2606 OID 16933)
-- Name: pagos_plan pagos_plan_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pagos_plan
    ADD CONSTRAINT pagos_plan_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.superadmins(id);


--
-- TOC entry 3936 (class 2606 OID 17062)
-- Name: prestamos prestamos_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestamos
    ADD CONSTRAINT prestamos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;


--
-- TOC entry 3937 (class 2606 OID 17056)
-- Name: prestamos prestamos_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestamos
    ADD CONSTRAINT prestamos_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados_prestatario(id) ON DELETE SET NULL;


--
-- TOC entry 3938 (class 2606 OID 17051)
-- Name: prestamos prestamos_prestatario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestamos
    ADD CONSTRAINT prestamos_prestatario_id_fkey FOREIGN KEY (prestatario_id) REFERENCES public.prestatarios(id) ON DELETE SET NULL;


--
-- TOC entry 3939 (class 2606 OID 16938)
-- Name: prestamos prestamos_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestamos
    ADD CONSTRAINT prestamos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos_cantidad(id);


--
-- TOC entry 3940 (class 2606 OID 16943)
-- Name: prestamos prestamos_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestamos
    ADD CONSTRAINT prestamos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id);


--
-- TOC entry 3941 (class 2606 OID 16948)
-- Name: prestamos prestamos_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestamos
    ADD CONSTRAINT prestamos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3959 (class 2606 OID 17033)
-- Name: prestatarios prestatarios_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prestatarios
    ADD CONSTRAINT prestatarios_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id) ON DELETE CASCADE;


--
-- TOC entry 3942 (class 2606 OID 17142)
-- Name: productos_cantidad productos_cantidad_linea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_cantidad
    ADD CONSTRAINT productos_cantidad_linea_id_fkey FOREIGN KEY (linea_id) REFERENCES public.lineas_producto(id) ON DELETE SET NULL;


--
-- TOC entry 3943 (class 2606 OID 16953)
-- Name: productos_cantidad productos_cantidad_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_cantidad
    ADD CONSTRAINT productos_cantidad_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- TOC entry 3944 (class 2606 OID 16958)
-- Name: productos_cantidad productos_cantidad_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_cantidad
    ADD CONSTRAINT productos_cantidad_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id) ON DELETE CASCADE;


--
-- TOC entry 3945 (class 2606 OID 17137)
-- Name: productos_serial productos_serial_linea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_serial
    ADD CONSTRAINT productos_serial_linea_id_fkey FOREIGN KEY (linea_id) REFERENCES public.lineas_producto(id) ON DELETE SET NULL;


--
-- TOC entry 3946 (class 2606 OID 16963)
-- Name: productos_serial productos_serial_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_serial
    ADD CONSTRAINT productos_serial_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- TOC entry 3947 (class 2606 OID 16968)
-- Name: productos_serial productos_serial_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.productos_serial
    ADD CONSTRAINT productos_serial_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id) ON DELETE CASCADE;


--
-- TOC entry 3948 (class 2606 OID 16973)
-- Name: proveedores proveedores_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id) ON DELETE CASCADE;


--
-- TOC entry 3949 (class 2606 OID 16978)
-- Name: retomas retomas_factura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retomas
    ADD CONSTRAINT retomas_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES public.facturas(id) ON DELETE CASCADE;


--
-- TOC entry 3950 (class 2606 OID 17739)
-- Name: retomas retomas_prestamo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retomas
    ADD CONSTRAINT retomas_prestamo_id_fkey FOREIGN KEY (prestamo_id) REFERENCES public.prestamos(id) ON DELETE SET NULL;


--
-- TOC entry 3951 (class 2606 OID 17750)
-- Name: retomas retomas_producto_cantidad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retomas
    ADD CONSTRAINT retomas_producto_cantidad_id_fkey FOREIGN KEY (producto_cantidad_id) REFERENCES public.productos_cantidad(id) ON DELETE SET NULL;


--
-- TOC entry 3952 (class 2606 OID 17745)
-- Name: retomas retomas_producto_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retomas
    ADD CONSTRAINT retomas_producto_serial_id_fkey FOREIGN KEY (producto_serial_id) REFERENCES public.productos_serial(id) ON DELETE SET NULL;


--
-- TOC entry 3953 (class 2606 OID 17761)
-- Name: retomas retomas_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retomas
    ADD CONSTRAINT retomas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id);


--
-- TOC entry 3954 (class 2606 OID 16983)
-- Name: seriales seriales_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seriales
    ADD CONSTRAINT seriales_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos_serial(id) ON DELETE CASCADE;


--
-- TOC entry 3955 (class 2606 OID 17067)
-- Name: seriales seriales_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.seriales
    ADD CONSTRAINT seriales_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;


--
-- TOC entry 3956 (class 2606 OID 16988)
-- Name: sucursales sucursales_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id) ON DELETE CASCADE;


--
-- TOC entry 3967 (class 2606 OID 17204)
-- Name: tokens_recuperacion tokens_recuperacion_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens_recuperacion
    ADD CONSTRAINT tokens_recuperacion_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- TOC entry 3984 (class 2606 OID 17437)
-- Name: traslados traslados_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.traslados
    ADD CONSTRAINT traslados_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id);


--
-- TOC entry 3985 (class 2606 OID 17447)
-- Name: traslados traslados_sucursal_destino_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.traslados
    ADD CONSTRAINT traslados_sucursal_destino_id_fkey FOREIGN KEY (sucursal_destino_id) REFERENCES public.sucursales(id);


--
-- TOC entry 3986 (class 2606 OID 17442)
-- Name: traslados traslados_sucursal_origen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.traslados
    ADD CONSTRAINT traslados_sucursal_origen_id_fkey FOREIGN KEY (sucursal_origen_id) REFERENCES public.sucursales(id);


--
-- TOC entry 3987 (class 2606 OID 17452)
-- Name: traslados traslados_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.traslados
    ADD CONSTRAINT traslados_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- TOC entry 3957 (class 2606 OID 16993)
-- Name: usuarios usuarios_negocio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES public.negocios(id) ON DELETE CASCADE;


--
-- TOC entry 3958 (class 2606 OID 16998)
-- Name: usuarios usuarios_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id) ON DELETE SET NULL;


-- Completed on 2026-05-14 00:49:04

--
-- PostgreSQL database dump complete
--

\unrestrict AcIK3rthvOWgrgkpQymD9WoLZaycJguP6OpWgiubrYIeFjkLQC5eNgxz6vAUIlg

