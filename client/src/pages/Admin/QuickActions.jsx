import AdminLayout from '../../components/AdminLayout';

export default function QuickActions() {
  return (
    <AdminLayout title="Comandos rápidos">
      <div className="max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="inline-flex rounded-full bg-[#CFE8E9] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#4E769B]">
          Próximo módulo
        </div>
        <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">Acciones rápidas para operación diaria</h3>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Esta pantalla quedará reservada para comandos rápidos del admin: poner un cliente en recurrencia,
          borrar, cancelar, cambiar status y otras acciones operativas de un golpe.
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Por ahora, la activación rápida de recurrencia ya quedó resuelta directamente desde Citas y también desde Clientes
          con una ventana corta dedicada solo a recurrencia.
        </p>
      </div>
    </AdminLayout>
  );
}
