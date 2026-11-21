import './style.css'
import {createElement,LandPlot,Info,Search,ChevronDown,Scan,Layers,X,Map as MapIcon,MapPin,ArrowRight,ChevronLeft,Globe} from 'lucide'
import {loadData,title,street,unit,address,bounds,matchUnit,type Item,type Dataset} from './data'
import {attachMap,type AtlasMap,type Camera} from './map'
import {escapeHtml as esc,facts,showProfile} from './profile'
import manifest from '../data/geo/manifest.json'

const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!
const iconNodes={land:LandPlot,info:Info,search:Search,chevron:ChevronDown,frame:Scan,layers:Layers,close:X,map:MapIcon,pin:MapPin,arrow:ArrowRight,back:ChevronLeft,globe:Globe}
function icons(){for(const el of document.querySelectorAll<HTMLElement>('[data-icon]:empty')){const ic=iconNodes[el.dataset.icon as keyof typeof iconNodes];if(ic)el.append(createElement(ic,{'aria-hidden':'true','stroke-width':1.7}))}}
const sel=$('#selection'),division=$<HTMLSelectElement>('#division'),dialog=$<HTMLDialogElement>('#sourceDialog'),layerBtn=$<HTMLButtonElement>('#layerBtn'),menu=$<HTMLElement>('#layerMenu')
let d:Dataset,map:AtlasMap|undefined,area:Item|undefined,block:Item|undefined,building:Item|undefined,home:Item|undefined,streetName='',profileMode=['localhost','127.0.0.1','[::1]'].includes(location.hostname)?'local':'example',query=''
let pointOptions:Item[]=[]
const compare=new Intl.Collator('en-AU',{numeric:true,sensitivity:'base'}).compare
function options(el:HTMLSelectElement,items:[string,string][],placeholder:string,value=''){
 el.replaceChildren(new Option(placeholder,''),...items.map(([id,label])=>new Option(label,id)));el.value=value
}
let restoring=false,fullTerritory=false
function currentUrl(){if(restoring)return;const params=new URLSearchParams();if(area)params.set('suburb',String(area.properties.DIVISION_NAME));if(block)params.set('block',String(block.properties.BLOCK_KEY));if(home)params.set('address',String(home.properties.ADDRESS_ID));if(building)params.set('building',String(building.properties.OBJECTID));if(streetName&&!home)params.set('street',streetName);if(fullTerritory)params.set('view','territory');if(pointOptions.length)params.set('points',pointOptions.map(f=>f.properties.ADDRESS_ID).join(','));const path=location.pathname+(params.size?'?'+params:'');if(path!==location.pathname+location.search)history.pushState({},'',path)}
function initSources(){
 $('#sourceList').innerHTML=manifest.layers.map(row=>'<h3>'+esc(row.title)+'</h3><p>'+esc(row.coverage)+' <a href="'+esc(row.dataSource.sourceUrl)+'" target="_blank" rel="noopener">'+esc(row.dataSource.publisher)+'</a> · <a href="'+esc(row.dataSource.licenceUrl)+'" target="_blank" rel="noopener">'+esc(row.dataSource.licence)+'</a></p>').join('')+'<h3>Street basemap</h3><p><a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> Positron · OpenMapTiles · © OpenStreetMap contributors.</p>'
 $('#sourcesBtn').onclick=()=>dialog.showModal();$('#closeDialog').onclick=()=>dialog.close()
 dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}}
 layerBtn.onclick=()=>{menu.hidden=!menu.hidden;layerBtn.setAttribute('aria-expanded',String(!menu.hidden))}
}
function miniature(){
 const canvas=$<HTMLCanvasElement>('#mini');if(!canvas)return
 const ctx=canvas.getContext('2d');if(!ctx)return
 const king=d.divisions.features.find(f=>f.properties.DIVISION_NAME==='KINGSTON')!
 const [[west,south],[east,north]]=bounds(king)
 const w=640,h=200;canvas.width=w;canvas.height=h
 const scale=w/(east-west)*1.9,sy=scale/Math.cos(35.3*Math.PI/180)
 ctx.fillStyle='#dbe4cd';ctx.fillRect(0,0,w,h)
 for(const [features,color,line] of [[d.blocks.features,'#e8ebdd','#b8c5af'],[d.footprints.features,'#c8d4bf','#bccbb2']] as const){
  for(const f of features){if(f.geometry.type!=='Polygon'&&f.geometry.type!=='MultiPolygon')continue;ctx.beginPath()
   const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates
   for(const poly of polygons)for(const ring of poly){ring.forEach(([x,y],i)=>{const px=w/2+(x-(west+east)/2)*scale,py=h/2-(y-(south+north)/2)*sy;i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.closePath()}
   ctx.fillStyle=color;ctx.strokeStyle=line;ctx.lineWidth=1.2;ctx.fill('evenodd');ctx.stroke()
  }
 }
}
function legend(){return '<hr class="sectionLine"><div class="smallcap">Map key</div><div class="legendList">'+[['urban','Canberra urban extent'],['','Suburb boundary'],['border','ACT border']].map(([c,n])=>'<div class="legendItem"><span class="swatch '+c+'"></span>'+n+'</div>').join('')+'</div>'}
function card(){return '<hr class="sectionLine"><div class="smallcap">Property detail available</div><div class="featureCard"><div class="cardMap"><canvas id="mini" aria-hidden="true"></canvas><span class="pin"><i data-icon="pin"></i></span></div><div class="cardBody"><div class="cardTitle">Kingston</div><p>Explore registered blocks, building footprints and individual addresses.</p><button id="focusKingston" class="primary">Explore Kingston<i data-icon="arrow"></i></button></div></div>'}
function resetSpecific(){pointOptions=[];block=undefined;building=undefined;home=undefined;streetName='';query=''}
function overview(){fullTerritory=false;area=undefined;resetSpecific();division.value='';map?.overview();render();currentUrl()}
function chooseDivision(name:string){fullTerritory=false;if(!name){overview();return}const found=d.divisions.features.find(f=>f.properties.DIVISION_NAME===name);if(!found)return;area=found;division.value=name;resetSpecific();map?.division(found);render();currentUrl()}
function chooseBlock(id:number){pointOptions=[];block=d.blocks.features.find(f=>f.properties.BLOCK_KEY===id);home=undefined;building=undefined;streetName='';query='';map?.select(block);render();currentUrl()}
function chooseHome(id:number){
 const a=d.addresses.features.find(f=>f.properties.ADDRESS_ID===id);if(!a)return
 pointOptions=[];home=a;streetName=street(a);block=d.blocks.features.find(f=>f.properties.BLOCK_KEY===a.properties.BLOCK_KEY);building=undefined
 map?.select(block,home,matchUnit(home,d.units.features,d.addresses.features));render();currentUrl()
}
function chooseMappedAddresses(ids:number[]){
 if(ids.length===1){chooseHome(ids[0]);return}
 resetSpecific()
 const selected=new Set(ids)
 pointOptions=d.addresses.features.filter(f=>selected.has(Number(f.properties.ADDRESS_ID))).sort((a,b)=>compare(address(a),address(b)))
 const first=pointOptions[0]
 if(first && pointOptions.every(f=>f.properties.BLOCK_KEY===first.properties.BLOCK_KEY))block=d.blocks.features.find(b=>b.properties.BLOCK_KEY===first.properties.BLOCK_KEY)
 map?.select(block);render();currentUrl();$('#mappedAddresses')?.focus({preventScroll:true})
}
function chooseBuilding(id:number){pointOptions=[];const f=d.footprints.features.find(x=>x.properties.OBJECTID===id);if(!f)return;building=f;block=d.blocks.features.find(b=>b.properties.cadastreKey===f.properties.cadastreKey);home=undefined;streetName='';query='';map?.select(block,undefined,undefined,building);render();currentUrl()}
function record():string {
 if(!home)return ''
 const p=home.properties,u=matchUnit(home,d.units.features,d.addresses.features)
 return '<section class="record"><div class="smallcap">Property record</div><h3>'+esc(address(home))+'</h3><p class="bodyText">Kingston, ACT</p>'+facts([['ACT address ID',p.ADDRESS_ID],['Registered block',block?'Block '+block.properties.BLOCK_NUMBER+', section '+block.properties.SECTION_NUMBER:'Unavailable'],['Block key',p.BLOCK_KEY],['Unit plan',p.UNITPLAN_NO],['Unit title',p.UNIT_TITLE],['Unit geometry',u?'Exact match · ACT unit '+u.properties.ID:'Unavailable']])+'<label class="field">Profile data<select id="mode"><option value="local">Private local profile</option><option value="example">Synthetic example</option></select></label><div id="profile"></div></section>'
}
function renderDrill(){
 const addresses=block?d.addresses.features.filter(a=>a.properties.BLOCK_KEY===block!.properties.BLOCK_KEY):d.addresses.features
 const streets=[...new Set(addresses.map(street))].sort(compare)
 const matched=streetName?addresses.filter(a=>street(a)===streetName).sort((a,b)=>compare(unit(a),unit(b))):[]
 const buildings=block?d.footprints.features.filter(f=>f.properties.cadastreKey===block!.properties.cadastreKey):d.footprints.features
 sel.innerHTML='<hr class="sectionLine"><div class="smallcap">Kingston property explorer</div>'+(pointOptions.length?'<label class="field">Addresses at this location<select id="mappedAddresses"></select></label>':'')+'<label class="field">Find an address<input type="search" id="addressSearch" placeholder="Street, unit or ACT address ID" autocomplete="off" value="'+esc(query)+'"></label><div id="results"></div><label class="field">Registered block<select id="blocks"></select></label><label class="field">Street address<select id="streets"></select></label>'+(matched.length?'<label class="field">Address or unit<select id="addresses"></select></label>':'')+
 (block?'<div class="record"><div class="smallcap">Registered block</div>'+facts([['Block key',block.properties.BLOCK_KEY],['Area',block.properties.BLOCK_DERIVED_AREA?Number(block.properties.BLOCK_DERIVED_AREA).toLocaleString()+' m²':'Unavailable'],['Address records',addresses.length],['Building footprints',buildings.length]])+'</div>':'')+
 '<details '+(building?'open':'')+'><summary class="notice">Building footprints ('+buildings.length+')</summary><label class="field">Official footprint<select id="footprints"></select></label>'+(building?facts([['Footprint ID',building.properties.ID],['Building type',title(building.properties.BUILDING_TYPE)],['Source use',title(building.properties.USE_DESCRIPTION)],['Block join',block?'Exact cadastral key':'Unavailable']]):'')+'</details>'+record()
 if(pointOptions.length){const el=$<HTMLSelectElement>('#mappedAddresses');options(el,pointOptions.map(f=>[String(f.properties.ADDRESS_ID),address(f)+' / '+f.properties.ADDRESS_ID]),'Choose an address ('+pointOptions.length+' records)');el.onchange=()=>{if(el.value)chooseHome(+el.value)}}
 const blocks=$<HTMLSelectElement>('#blocks')
 options(blocks,d.blocks.features.map(f=>[String(f.properties.BLOCK_KEY),'Section '+f.properties.SECTION_NUMBER+' · Block '+f.properties.BLOCK_NUMBER] as [string,string]).sort((a,b)=>compare(a[1],b[1])),'All Kingston blocks',block?String(block.properties.BLOCK_KEY):'')
 blocks.onchange=()=>{if(blocks.value)chooseBlock(+blocks.value);else chooseDivision('KINGSTON')}
 const st=$<HTMLSelectElement>('#streets');options(st,streets.map(s=>[s,s]),streets.length?'Choose a street address':'No addresses on this block',streetName)
 st.onchange=()=>{streetName=st.value;home=undefined;map?.select(block);const choices=addresses.filter(a=>street(a)===streetName);if(choices.length===1)chooseHome(Number(choices[0].properties.ADDRESS_ID));else{render();currentUrl()}}
 if(matched.length){const el=$<HTMLSelectElement>('#addresses');options(el,matched.map(f=>[String(f.properties.ADDRESS_ID),(unit(f)?'Unit '+unit(f):'Street address')+' · '+f.properties.ADDRESS_ID]),'Choose an address record',home?String(home.properties.ADDRESS_ID):'');el.onchange=()=>{if(el.value)chooseHome(+el.value);else{home=undefined;map?.select(block);render();currentUrl()}}}
 const fp=$<HTMLSelectElement>('#footprints');options(fp,buildings.map(f=>[String(f.properties.OBJECTID),f.properties.ID+' · '+title(f.properties.USE_DESCRIPTION)]),'Choose a footprint',building?String(building.properties.OBJECTID):'');fp.onchange=()=>{if(fp.value)chooseBuilding(+fp.value);else{building=undefined;map?.select(block,home,home&&matchUnit(home,d.units.features,d.addresses.features));render();currentUrl()}}
 const input=$<HTMLInputElement>('#addressSearch'),results=$('#results')
 function search(){query=input.value;results.replaceChildren();if(!query.trim())return
 const q=query.trim().toLowerCase();const hits=d.addresses.features.filter(f=>address(f).toLowerCase().includes(q)||String(f.properties.ADDRESS_ID)===q).sort((a,b)=>compare(address(a),address(b))).slice(0,25)
 if(!hits.length){results.textContent='No matching addresses.';return}
 const choices=document.createElement('select');choices.setAttribute('aria-label','Address search results');choices.className='searchResults';options(choices,hits.map(f=>[String(f.properties.ADDRESS_ID),address(f)+' · '+f.properties.ADDRESS_ID]),'Choose a result ('+hits.length+(hits.length===25?' shown':'')+')');choices.onchange=()=>{if(choices.value){query='';chooseHome(+choices.value)}};results.append(choices)
 }
 input.oninput=search;search()
 if(home){const m=$<HTMLSelectElement>('#mode');m.value=profileMode;const update=()=>{profileMode=m.value;showProfile($('#profile'),home!,profileMode)};m.onchange=update;update()}
}
function render(){
 const name=area?title(area.properties.DIVISION_NAME):''
 $('#panelTitle').textContent=name||'Explore Canberra';$('#panelIntro').textContent=!area?'Browse suburb boundaries and explore property detail in Kingston.':name==='Kingston'?'Choose a block or search an address to inspect the official property records.':'Explore the official division boundary for '+name+'.'
 $('#place').textContent='Canberra  /  '+(fullTerritory?'ACT border':name||'Overview')
 if(name==='Kingston')renderDrill()
 else{sel.innerHTML=(area?'<hr class="sectionLine"><div class="smallcap">Division record</div>'+facts([['Division code',area.properties.DIVISION_CODE],['Property detail','Kingston only']]):'')+card()+legend()+'<button class="back territoryBtn" id="territory"><i data-icon="globe"></i> View full ACT border</button>';$('#focusKingston').onclick=()=>chooseDivision('KINGSTON');$('#territory').onclick=()=>{fullTerritory=true;area=undefined;resetSpecific();division.value='';map?.overview();map?.territory();render();currentUrl()};miniature()}
 icons()
}
async function init(){
 icons();initSources();$('#status').textContent='Loading official map layers…';d=await loadData()
 options(division,d.divisions.features.map(f=>[String(f.properties.DIVISION_NAME),title(f.properties.DIVISION_NAME)] as [string,string]).sort((a,b)=>compare(a[1],b[1])),'Choose a suburb')
 try{map=attachMap(d,{division:chooseDivision,block:chooseBlock,addresses:chooseMappedAddresses,footprint:chooseBuilding});$('#status').textContent=''}catch{$('#status').textContent='Map rendering is unavailable. Use the suburb and property controls to explore the records.'}
 division.onchange=()=>chooseDivision(division.value);$('#overview').onclick=overview
 function restore(){
   restoring=true
   const saved=history.state?.camera as Camera|undefined
   const params=new URLSearchParams(location.search)
   chooseDivision(params.get('suburb')||'')
   if(area?.properties.DIVISION_NAME==='KINGSTON'){
     if(params.has('address'))chooseHome(Number(params.get('address')))
     else if(params.has('building'))chooseBuilding(Number(params.get('building')))
     else if(params.has('points'))chooseMappedAddresses(params.get('points')!.split(',').map(Number))
     else {
       if(params.has('block'))chooseBlock(Number(params.get('block')))
       if(params.has('street')){streetName=params.get('street')!;render()}
     }
   }else if(params.get('view')==='territory'){fullTerritory=true;map?.territory();render()}
   if(saved)map?.restoreCamera(saved)
   restoring=false
 }
 restore()
 map?.onCamera(()=>{if(!restoring)history.replaceState({camera:map?.camera()},'')})
 addEventListener('popstate',restore)
}
void init().catch(()=>{$('#status').textContent='Official map layers could not load. Refresh to retry.'})

