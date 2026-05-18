import { useState, useCallback, useRef } from 'react';
import { X, LayoutGrid } from 'lucide-react';
import { Button } from '../../components/ui/Button';

const FILAS_MIN = 150;

function filaVacia(caracteristicasLista) {
  return {
    imei: '',
    color: '',
    caracteristicas: Object.fromEntries((caracteristicasLista || []).map((k) => [k, ''])),
    costo: '',
  };
}

function buildCols(caracteristicasActivo, caracteristicasLista, coloresActivo, costoModo) {
  const cols = ['imei'];
  if (caracteristicasActivo && caracteristicasLista?.length > 0) {
    for (const nombre of caracteristicasLista) cols.push(`car_${nombre}`);
  }
  if (coloresActivo) cols.push('color');
  if (costoModo === 'individual') cols.push('costo');
  return cols;
}

function parsearNumero(str) {
  const limpio = String(str).replace(/\D/g, '');
  if (!limpio) return '';
  return parseInt(limpio, 10);
}

function formatearMiles(valor) {
  if (valor === '' || valor === null || valor === undefined) return '';
  const n = parseInt(String(valor).replace(/\D/g, ''), 10);
  if (isNaN(n)) return '';
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function CuadriculaImei({
  productoNombre,
  caracteristicasActivo,
  caracteristicasLista,
  coloresActivo,
  coloresConfig,
  precioCopInicial,
  filasIniciales,
  onGuardar,
  onCerrar,
}) {
  const [filas, setFilas] = useState(() => {
    const base = filasIniciales?.length
      ? filasIniciales.map((f) => ({
          imei: f.imei || '',
          color: f.color || '',
          caracteristicas: Object.fromEntries(
            (caracteristicasLista || []).map((k) => [k, f.caracteristicas?.[k] || ''])
          ),
          costo: f.costo !== undefined && f.costo !== null ? f.costo : '',
        }))
      : [];
    while (base.length < FILAS_MIN) base.push(filaVacia(caracteristicasLista));
    return base;
  });
  const [costoModo, setCostoModo] = useState('grupal');
  const [costoGrupal, setCostoGrupal] = useState(precioCopInicial || '');
  const [costoGrupalDisplay, setCostoGrupalDisplay] = useState(formatearMiles(precioCopInicial) || '');
  const [focusedCell, setFocusedCell] = useState(null); // { row, col }
  const [error, setError] = useState('');
  const containerRef = useRef(null);

  const cols = buildCols(caracteristicasActivo, caracteristicasLista, coloresActivo, costoModo);

  const handleCellChange = useCallback((rowIdx, colId, value) => {
    setFilas((prev) => {
      const next = [...prev];
      const row = { ...next[rowIdx] };
      if (colId === 'imei') {
        row.imei = value;
      } else if (colId === 'color') {
        row.color = value;
      } else if (colId === 'costo') {
        row.costo = value;
      } else if (colId.startsWith('car_')) {
        const nombre = colId.slice(4);
        row.caracteristicas = { ...row.caracteristicas, [nombre]: value };
      }
      next[rowIdx] = row;
      return next;
    });
  }, []);

  const handlePaste = useCallback((e) => {
    if (!focusedCell) return;
    e.preventDefault();
    const raw = e.clipboardData.getData('text/plain');
    if (!raw) return;

    const rawRows = raw.split(/\r?\n/).filter((r) => r !== '');
    const parsed = rawRows.map((r) => r.split('\t').map((c) => c.trim()));

    const startColIdx = cols.indexOf(focusedCell.col);
    if (startColIdx === -1) return;
    const startRowIdx = focusedCell.row;

    setFilas((prev) => {
      const next = [...prev];
      for (let rOffset = 0; rOffset < parsed.length; rOffset++) {
        const targetRowIdx = startRowIdx + rOffset;
        while (next.length <= targetRowIdx) next.push(filaVacia(caracteristicasLista));
        const row = { ...next[targetRowIdx] };
        const pastedRow = parsed[rOffset];
        for (let cOffset = 0; cOffset < pastedRow.length; cOffset++) {
          const colId = cols[startColIdx + cOffset];
          if (!colId) break;
          const cellVal = pastedRow[cOffset];
          if (colId === 'imei') {
            row.imei = cellVal;
          } else if (colId === 'color') {
            row.color = cellVal;
          } else if (colId === 'costo') {
            const n = parsearNumero(cellVal);
            row.costo = n;
          } else if (colId.startsWith('car_')) {
            const nombre = colId.slice(4);
            row.caracteristicas = { ...row.caracteristicas, [nombre]: cellVal };
          }
        }
        next[targetRowIdx] = row;
      }
      while (next.length < FILAS_MIN) next.push(filaVacia(caracteristicasLista));
      return next;
    });
  }, [focusedCell, cols, caracteristicasLista]);

  const imeisValidos = filas.filter((f) => f.imei.trim()).length;

  // Detectar duplicados en tiempo real para resaltar celdas
  const imeisDuplicadosSet = (() => {
    const conteo = {};
    for (const f of filas) {
      const key = f.imei.trim().toLowerCase();
      if (key) conteo[key] = (conteo[key] || 0) + 1;
    }
    return new Set(Object.keys(conteo).filter((k) => conteo[k] > 1));
  })();

  const handleGuardar = () => {
    setError('');
    const filasValidas = filas.filter((f) => f.imei.trim() !== '');
    if (filasValidas.length === 0) {
      setError('Ingresa al menos un IMEI');
      return;
    }
    if (imeisDuplicadosSet.size > 0) {
      const ejemplos = [...imeisDuplicadosSet].slice(0, 3).join(', ');
      setError(`Corrige los IMEIs duplicados antes de guardar: ${ejemplos}${imeisDuplicadosSet.size > 3 ? '...' : ''}`);
      return;
    }
    const rows = filasValidas.map((f) => ({
      imei: f.imei.trim(),
      color: f.color?.trim() || '',
      caracteristicas: f.caracteristicas,
      costo: costoModo === 'individual' ? (f.costo !== '' ? Number(f.costo) : null) : null,
    }));
    onGuardar(rows, costoModo === 'grupal' ? (costoGrupal !== '' ? Number(costoGrupal) : null) : null);
  };

  const cellInputClass = (rowIdx, colId, imeiVal) => {
    const esDuplicado = colId === 'imei' && imeiVal?.trim() && imeisDuplicadosSet.has(imeiVal.trim().toLowerCase());
    if (esDuplicado) {
      return 'w-full px-2 py-1 border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-red-400 border-red-400 bg-red-50 text-red-700';
    }
    return `w-full px-2 py-1 border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 focus:bg-blue-50
    ${focusedCell?.row === rowIdx && focusedCell?.col === colId
      ? 'border-blue-400 bg-blue-50'
      : 'border-gray-200 bg-white hover:border-gray-300'}`;
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: '92vw', maxWidth: '92vw', height: '88vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-xl">
              <LayoutGrid size={16} className="text-purple-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Cuadrícula de IMEIs</h2>
              <p className="text-xs text-gray-400 truncate max-w-xs">{productoNombre}</p>
            </div>
          </div>

          {/* Toggle costo */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 font-medium">Tipo de costo:</span>
            <div className="flex items-center bg-gray-100 rounded-xl p-1">
              <button
                type="button"
                onClick={() => setCostoModo('grupal')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${costoModo === 'grupal' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Costo grupal
              </button>
              <button
                type="button"
                onClick={() => setCostoModo('individual')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${costoModo === 'individual' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Costo individual
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onCerrar}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Costo grupal input */}
        {costoModo === 'grupal' && (
          <div className="px-5 py-2.5 border-b border-gray-100 flex items-center gap-3 flex-shrink-0 bg-gray-50">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">
              Costo por unidad (COP)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={costoGrupalDisplay}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '');
                const n = raw === '' ? '' : parseInt(raw, 10);
                setCostoGrupal(n);
                setCostoGrupalDisplay(n === '' ? '' : n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
              }}
              placeholder="0"
              className="w-44 px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <p className="text-xs text-gray-400">Se aplicará a todos los IMEIs ingresados</p>
          </div>
        )}

        {/* Hint paste */}
        <div className="px-5 py-2 bg-blue-50 border-b border-blue-100 flex-shrink-0">
          <p className="text-xs text-blue-600">
            Haz clic en cualquier celda y pega con <kbd className="bg-blue-100 px-1 rounded font-mono">Ctrl+V</kbd> desde Excel — se llenan las filas automáticamente según las columnas
          </p>
        </div>

        {/* Grid scrollable */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto"
          onPaste={handlePaste}
        >
          <table className="w-full border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '36px' }} />
              <col style={{ minWidth: '180px' }} />
              {caracteristicasActivo && (caracteristicasLista || []).map((n) => (
                <col key={n} style={{ minWidth: '120px' }} />
              ))}
              {coloresActivo && <col style={{ minWidth: '110px' }} />}
              {costoModo === 'individual' && <col style={{ minWidth: '130px' }} />}
            </colgroup>
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b-2 border-gray-200">
                <th className="px-2 py-2 text-right text-gray-400 font-medium select-none">#</th>
                <th className="px-2 py-2 text-left text-gray-600 font-semibold">Serial / IMEI</th>
                {caracteristicasActivo && (caracteristicasLista || []).map((nombre) => (
                  <th key={nombre} className="px-2 py-2 text-left text-gray-600 font-semibold">
                    {nombre}
                  </th>
                ))}
                {coloresActivo && (
                  <th className="px-2 py-2 text-left text-gray-600 font-semibold">Color</th>
                )}
                {costoModo === 'individual' && (
                  <th className="px-2 py-2 text-left text-gray-600 font-semibold">Costo (COP)</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}
                >
                  <td className="px-2 py-0 text-right text-gray-300 select-none font-mono">
                    {rowIdx + 1}
                  </td>

                  {/* IMEI */}
                  <td className="px-0 py-0">
                    <input
                      type="text"
                      value={fila.imei}
                      onFocus={() => setFocusedCell({ row: rowIdx, col: 'imei' })}
                      onChange={(e) => handleCellChange(rowIdx, 'imei', e.target.value)}
                      placeholder={rowIdx < 5 ? 'Serial / IMEI...' : ''}
                      className={cellInputClass(rowIdx, 'imei', fila.imei)}
                      title={imeisDuplicadosSet.has(fila.imei.trim().toLowerCase()) && fila.imei.trim() ? 'IMEI duplicado' : undefined}
                    />
                  </td>

                  {/* Características */}
                  {caracteristicasActivo && (caracteristicasLista || []).map((nombre) => (
                    <td key={nombre} className="px-0 py-0">
                      <input
                        type="text"
                        value={fila.caracteristicas?.[nombre] || ''}
                        onFocus={() => setFocusedCell({ row: rowIdx, col: `car_${nombre}` })}
                        onChange={(e) => handleCellChange(rowIdx, `car_${nombre}`, e.target.value)}
                        placeholder={rowIdx < 3 ? nombre : ''}
                        className={cellInputClass(rowIdx, `car_${nombre}`)}
                      />
                    </td>
                  ))}

                  {/* Color */}
                  {coloresActivo && (
                    <td className="px-0 py-0">
                      {coloresConfig?.length > 0 ? (
                        <select
                          value={fila.color || ''}
                          onFocus={() => setFocusedCell({ row: rowIdx, col: 'color' })}
                          onChange={(e) => handleCellChange(rowIdx, 'color', e.target.value)}
                          className={`w-full px-2 py-1 border text-xs focus:outline-none focus:ring-1 focus:ring-blue-400
                            ${focusedCell?.row === rowIdx && focusedCell?.col === 'color'
                              ? 'border-blue-400 bg-blue-50'
                              : 'border-gray-200 bg-white'}`}
                        >
                          <option value="">—</option>
                          {coloresConfig.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={fila.color || ''}
                          onFocus={() => setFocusedCell({ row: rowIdx, col: 'color' })}
                          onChange={(e) => handleCellChange(rowIdx, 'color', e.target.value)}
                          className={cellInputClass(rowIdx, 'color')}
                        />
                      )}
                    </td>
                  )}

                  {/* Costo individual */}
                  {costoModo === 'individual' && (
                    <td className="px-0 py-0">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fila.costo !== '' && fila.costo !== null && fila.costo !== undefined
                          ? formatearMiles(fila.costo)
                          : ''}
                        onFocus={() => setFocusedCell({ row: rowIdx, col: 'costo' })}
                        onChange={(e) => {
                          const n = parsearNumero(e.target.value);
                          handleCellChange(rowIdx, 'costo', n);
                        }}
                        placeholder="0"
                        className={cellInputClass(rowIdx, 'costo')}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-white">
          <div>
            <p className="text-xs text-gray-500">
              <span className="font-semibold text-gray-700">{imeisValidos}</span> IMEI(s) ingresado(s)
              {imeisDuplicadosSet.size > 0 && (
                <span className="ml-2 text-red-500 font-semibold">
                  · {imeisDuplicadosSet.size} duplicado(s)
                </span>
              )}
            </p>
            {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleGuardar} disabled={imeisValidos === 0}>
              Guardar IMEIs
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
