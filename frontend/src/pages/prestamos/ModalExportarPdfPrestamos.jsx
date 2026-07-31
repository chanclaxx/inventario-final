import { FileText, LayoutList } from 'lucide-react';
import { ModalExportarCuenta } from '../../components/ui/ModalExportarCuenta';
import { descargarPdfPrestamosActivos, descargarPdfEstadoCuenta } from '../../api/prestamos.api';

export function ModalExportarPdfPrestamos({ tipo, personaId, personaNombre, onClose }) {
  const tipoApi = tipo === 'companero' ? 'prestatario' : tipo;
  const sufijo  = personaNombre || personaId;

  const opciones = [
    {
      id:          'activos',
      Icn:         FileText,
      titulo:      'Préstamos activos',
      descripcion: 'Lista de préstamos vigentes con sus abonos y saldo pendiente de cada uno.',
      color:       'blue',
      archivo:     `prestamos-activos-${sufijo}.pdf`,
      descargar:   () => descargarPdfPrestamosActivos(tipoApi, personaId),
    },
    {
      id:          'cuenta',
      Icn:         LayoutList,
      titulo:      'Estado de cuenta',
      descripcion: 'Todos los movimientos (préstamos, abonos, compras) con saldo acumulado en 5 columnas.',
      color:       'purple',
      archivo:     `estado-cuenta-${sufijo}.pdf`,
      descargar:   () => descargarPdfEstadoCuenta(tipoApi, personaId),
    },
  ];

  return (
    <ModalExportarCuenta
      opciones={opciones}
      personaNombre={personaNombre}
      onClose={onClose}
    />
  );
}
