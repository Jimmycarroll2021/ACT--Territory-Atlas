import {address,type Item} from './data'
export const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export const facts=(rows:[string,unknown][])=>'<dl class="facts">'+rows.map(([label,value])=>'<dt>'+escapeHtml(label)+'</dt><dd>'+escapeHtml(value??'Unavailable')+'</dd>').join('')+'</dl>'
type Sale={date?:string,price?:number,source?:string,matchStatus?:string}
type Profile={addressId?:string,displayAddress?:string,beds?:number,baths?:number,parking?:number,featuresSource?:string,featuresObservedAt?:string,sales?:Sale[]}
let token=0
export function showProfile(container:HTMLElement,a:Item,mode:string){
 const request=++token
 const synthetic:Profile={beds:2,baths:1,parking:1,featuresSource:'Synthetic example',featuresObservedAt:'2025-03-01',sales:[{date:'2025-03-01',price:650000,source:'Synthetic example',matchStatus:'Illustrative'}]}
 function render(profile:Profile|undefined){
   if(request!==token || !container.isConnected)return
   const heading=mode==='example'?'Synthetic example':'Local property profile'
   if(!profile){container.innerHTML='<div class="profile"><h3>'+heading+'</h3><p class="notice">Unavailable for this address.</p></div>';return}
   const sales=profile.sales?.map(sale=>'<div class="record">'+facts([['Sale date',sale.date],['Sale price',typeof sale.price==='number'?new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(sale.price):sale.price],['Source',sale.source],['Match',sale.matchStatus]])+'</div>').join('')
   container.innerHTML='<div class="profile"><h3>'+heading+'</h3>'+(mode==='example'?'<p class="notice">Illustrative figures only. The example is fictional for every address.</p>':'')+facts([['Bedrooms',profile.beds],['Bathrooms',profile.baths],['Parking',profile.parking],['Feature source',profile.featuresSource],['Observed',profile.featuresObservedAt]])+'<strong class="groupTitle">Sale history</strong>'+(sales||'<p class="notice">Unavailable.</p>')+'</div>'
 }
 if(mode==='example'){render(synthetic);return}
 container.innerHTML='<p role="status" class="notice">Checking local profile…</p>'
 const id=String(a.properties.ADDRESS_ID)
 if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)){render(undefined);return}
 void fetch('/api/properties/'+encodeURIComponent(id),{cache:'no-store',signal:AbortSignal.timeout(5000)}).then(async r=>r.ok ? r.json() : null).then((row:Profile|null)=>render(row && String(row.addressId)===id ? row : undefined)).catch(()=>render(undefined))
}
export const displayName=(a:Item)=>escapeHtml(address(a))

