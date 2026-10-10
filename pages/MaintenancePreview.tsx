import React from 'react';
import MaintenanceModal from '../components/MaintenanceModal';
export default function MaintenancePreview(){return <div className="min-h-screen bg-slate-100 p-8"><h1>Prévia local — dados fictícios</h1><MaintenanceModal onClose={()=>window.history.back()} api={async()=>({revision:0,editable:['categories'],items:{categories:[{id:'1',label:'1 - Conta de demonstração',active:true},{id:'2',label:'2 - Fornecedor de demonstração',active:false}],banks:[{id:'b',label:'Banco de demonstração',active:true}]}})}/></div>;}
