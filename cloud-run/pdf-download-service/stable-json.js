// Object field order is not part of a Firestore record's identity.
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
module.exports=value=>JSON.stringify(canonical(value));
