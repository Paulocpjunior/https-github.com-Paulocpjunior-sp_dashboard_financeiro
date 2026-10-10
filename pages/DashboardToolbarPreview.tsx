import React, { useState } from 'react';
import DashboardToolbar from '../components/DashboardToolbar';
export default function DashboardToolbarPreview() {
 const [last, setLast] = useState('Nenhuma ação');
 const [open,setOpen] = useState(false);
 return <main className="min-h-screen bg-slate-100 dark:bg-slate-950 p-4 sm:p-8"><div className="mx-auto max-w-6xl"><p className="mb-4 text-slate-500">Prévia local - dados fictícios</p><DashboardToolbar title="Contas a pagar" isAdmin lastUpdated={new Date('2026-10-10T17:00:00-03:00')} refreshCountdown={45} isRefreshing={false} hasFilters filtersOpen={open} onNewReceivable={()=>setLast('Nova conta a receber')} onNewPayable={()=>setLast('Nova conta a pagar')} onRecurrences={()=>setLast('Recorrências a pagar')} onRefresh={()=>setLast('Atualizar')} onFilters={()=>{setOpen(!open);setLast('Filtros');}} onPrint={()=>setLast('Imprimir')} onExport={()=>setLast('Exportar')} onWhatsApp={()=>setLast('WhatsApp')}/><p role="status" className="mt-4 text-slate-500">{last}</p></div></main>;
}
