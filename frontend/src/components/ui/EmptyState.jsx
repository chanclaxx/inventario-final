export function EmptyState({ icon: Icon, titulo, descripcion, accion }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {Icon && (
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
          <Icon size={32} className="text-gray-400" />
        </div>
      )}
      <h3 className="text-base font-semibold text-gray-700 mb-1">{titulo}</h3>
      {descripcion && <p className="text-sm text-gray-400 mb-4">{descripcion}</p>}
      {accion}
    </div>
  );
}