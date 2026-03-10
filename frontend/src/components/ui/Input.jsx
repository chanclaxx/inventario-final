export function Input({ label, error, className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700">{label}</label>
      )}
      <input
        className={`
          w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-gray-900
          placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
          focus:bg-white transition-all duration-150 text-sm
          ${error ? 'ring-2 ring-red-400 bg-red-50' : ''}
          ${className}
        `}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}