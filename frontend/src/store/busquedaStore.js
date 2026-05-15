import { create } from 'zustand';

const useBusquedaStore = create((set) => ({
  modo:     'imei',
  input:    '',
  busqueda: '',

  setModo:     (modo)     => set({ modo, input: '', busqueda: '' }),
  setInput:    (input)    => set({ input }),
  setBusqueda: (busqueda) => set({ busqueda }),
  limpiar:     ()         => set({ input: '', busqueda: '' }),
}));

export default useBusquedaStore;
