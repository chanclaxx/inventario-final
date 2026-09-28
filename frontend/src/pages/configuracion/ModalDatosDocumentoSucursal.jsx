import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, X } from 'lucide-react';
import api from '../../api/axios.config';
import { getDatosDocumentoSucursal, guardarDatosDocumentoSucursal } from '../../api/sucursales.api';
import { comprimirLogo } from '../../utils/logoDataUrl';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Input }   from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';

// ─────────────────────────────────────────────────────────────────────────────
// DATOS DE LA SUCURSAL PARA LOS DOCUMENTOS
//
// Nombre comercial, NIT, dirección, teléfono y logo con que se imprimen las
// facturas (PDF y POS), préstamos, abonos, órdenes de servicio y demás
// documentos de ESTA sede. Lo que se deje vacío se toma del negocio (Ajustes →
// Negocio), y por eso cada campo muestra de placeholder lo que saldría.
//
// El formulario se REMONTA por `key` cuando llegan los datos, en vez de
// sincronizarlos con un efecto.
// ─────────────────────────────────────────────────────────────────────────────

function Formulario({ sucursal, guardados, negocio, onClose }) {
  const queryClient = useQueryClient();
  // Sin datos guardados, la dirección y el teléfono arrancan con los de la
  // sucursal: es lo que casi siempre se quiere, y queda a la vista antes de
  // guardar (no se imprimen solos).
  const [form, setForm] = useState({
    nombre_comercial: guardados?.nombre_comercial || '',
    nit:              guardados?.nit              || '',
    direccion:        guardados ? (guardados.direccion || '') : (sucursal.direccion || ''),
    telefono:         guardados ? (guardados.telefono  || '') : (sucursal.telefono  || ''),
    logo:             guardados?.logo || '',
  });
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () => guardarDatosDocumentoSucursal(sucursal.id, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sucursales-documento'] });
      queryClient.invalidateQueries({ queryKey: ['sucursal-documento', sucursal.id] });
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudieron guardar los datos'),
  });

  const subirLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > 5 * 1024 * 1024) return setError('El archivo es demasiado grande. Máximo 5 MB.');
    try {
      setForm((f) => ({ ...f, logo: '' }));
      const b64 = await comprimirLogo(file);
      setForm((f) => ({ ...f, logo: b64 }));
    } catch {
      setError('No se pudo procesar la imagen.');
    }
  };

  const campo = (clave, label, heredado) => (
    <Input
      label={label}
      placeholder={heredado ? `Del negocio: ${heredado}` : 'Sin dato'}
      value={form[clave]}
      onChange={(e) => setForm({ ...form, [clave]: e.target.value })}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-gray-400 -mt-1">
        Así salen las facturas, préstamos, recibos y demás documentos de
        <strong className="text-gray-600"> {sucursal.nombre}</strong>. Lo que dejes
        vacío se toma de los datos del negocio.
      </p>
      {campo('nombre_comercial', 'Nombre comercial', negocio?.nombre_negocio)}
      {campo('nit', 'NIT', negocio?.nit)}
      {campo('direccion', 'Dirección', negocio?.direccion)}
      {campo('telefono', 'Teléfono', negocio?.telefono)}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-gray-700">Logo</span>
        {form.logo ? (
          <div className="flex items-center gap-3">
            <img src={form.logo} alt="Logo de la sucursal"
              className="w-16 h-16 object-contain border border-gray-200 rounded-xl bg-gray-50 p-1" />
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5
              bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-xl transition-colors">
              <Upload size={13} /> Cambiar
              <input type="file" accept="image/*" onChange={subirLogo} className="hidden" />
            </label>
            <button type="button" onClick={() => setForm({ ...form, logo: '' })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5
                bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold rounded-xl transition-colors">
              <X size={13} /> Quitar
            </button>
          </div>
        ) : (
          <label className="cursor-pointer flex items-center gap-2 border-2 border-dashed
            border-gray-200 hover:border-blue-300 rounded-xl px-3 py-3 transition-colors">
            <Upload size={16} className="text-gray-300" />
            <span className="text-xs text-gray-400">
              {negocio?.logo_negocio ? 'Sin logo propio: se usa el del negocio. Subir uno' : 'Subir logo'}
            </span>
            <input type="file" accept="image/*" onChange={subirLogo} className="hidden" />
          </label>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1" loading={mut.isPending} onClick={() => { setError(''); mut.mutate(); }}>
          Guardar
        </Button>
      </div>
    </div>
  );
}

export function ModalDatosDocumentoSucursal({ sucursal, onClose }) {
  const { data: guardados, isLoading, isError } = useQuery({
    queryKey: ['sucursal-documento', sucursal.id],
    queryFn:  () => getDatosDocumentoSucursal(sucursal.id).then((r) => r.data.data),
    staleTime: 0,
  });
  const { data: negocio } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });

  return (
    <Modal open onClose={onClose} title="Datos para documentos" size="sm">
      {isLoading ? <Spinner className="py-8" />
        : isError ? <p className="text-sm text-red-500">No se pudieron cargar los datos de la sucursal.</p>
        : (
          <Formulario
            key={guardados ? 'guardados' : 'nuevo'}
            sucursal={sucursal}
            guardados={guardados}
            negocio={negocio}
            onClose={onClose}
          />
        )}
    </Modal>
  );
}

export default ModalDatosDocumentoSucursal;
