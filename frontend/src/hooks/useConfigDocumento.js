import { useQuery } from '@tanstack/react-query';
import { getDatosDocumentoSucursales } from '../api/sucursales.api';
import { aplicarDatosSucursal } from '../utils/emisor';

// ─────────────────────────────────────────────────────────────────────────────
// La config con que se imprime un documento de `sucursalId`: la del negocio
// con los datos propios de esa sede encima (Ajustes → Sucursales → «Datos para
// documentos»). Es la misma regla que aplica el backend a los PDF, así el
// ticket y el PDF del mismo documento dicen lo mismo.
//
// La sede es la del DOCUMENTO (dónde se vendió, prestó o recibió), no la que
// tiene abierta quien imprime: un admin que reimprime una factura de Bunny
// desde otra sede tiene que sacar el encabezado de Bunny.
//
// Sin sede, o mientras carga, devuelve la config tal cual — nunca bloquea la
// impresión.
// ─────────────────────────────────────────────────────────────────────────────
export function useConfigDocumento(config, sucursalId) {
  const { data: datos = [] } = useQuery({
    queryKey: ['sucursales-documento'],
    queryFn:  () => getDatosDocumentoSucursales().then((r) => r.data.data || []),
    staleTime: 5 * 60 * 1000,
  });
  const propios = sucursalId != null
    ? datos.find((d) => Number(d.sucursal_id) === Number(sucursalId))
    : null;
  return aplicarDatosSucursal(config || {}, propios);
}

export default useConfigDocumento;
