function invalid(message) { throw Object.assign(Error(message),{status:400}); }
function recurrenceSchedule(input) {
  if (!['continuous','months'].includes(input.schedule)) invalid('Selecione recorrência contínua ou meses específicos.');
  if (input.schedule === 'continuous') return {schedule:'continuous',months:Array.from({length:12},(_,i)=>i+1),end:null};
  if (!Array.isArray(input.months) || !input.months.length || input.months.some(m=>!Number.isInteger(m)||m<1||m>12) || new Set(input.months).size!==input.months.length)
    invalid('Selecione pelo menos um dos 12 meses, sem repetições.');
  return {schedule:'months',months:[...input.months].sort((a,b)=>a-b),end:String(input.end||'')};
}
function includesMonth(rule, month) {
  if (month < rule.start) return false;
  if (rule.schedule === 'continuous') return true;
  if (!rule.end || month > rule.end) return false;
  // Existing rules retain their original inclusive start/end interval.
  return !rule.schedule || (rule.schedule === 'months' && rule.months?.includes(Number(month.slice(5,7))));
}
module.exports={recurrenceSchedule,includesMonth};
