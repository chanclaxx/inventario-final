// src/pages/SinAccesoPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Página que se muestra cuando un usuario intenta acceder a un módulo
// para el que no tiene permisos.
// ─────────────────────────────────────────────────────────────────────────────

import { useNavigate } from 'react-router-dom';
import { ShieldOff, ArrowLeft } from 'lucide-react';

export default function SinAccesoPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 px-4">
      <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center">
        <ShieldOff size={32} className="text-red-400" />
      </div>

      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900">Sin acceso</h1>
        <p className="text-sm text-gray-400 mt-2 max-w-xs">
          No tienes permiso para ver este módulo.
          Contacta al administrador si crees que es un error.
        </p>
      </div>

      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
          bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
      >
        <ArrowLeft size={15} />
        Volver
      </button>
    </div>
  );
}