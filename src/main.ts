import './style.css'
import {createElement,LandPlot,Info,Search,ChevronDown,Scan,Layers,X,Map as MapIcon,MapPin,ArrowRight,ChevronLeft,Globe} from 'lucide'
import {loadLayers,overviewLayers,kingstonLayers,title,street,unit,address,bounds,matchUnit,type Item,type LayerName} from './data'
import {attachMap,type AtlasMap,type Camera} from './map'
import {escapeHtml as esc,facts,showProfile} from './profile'
import {showPlanning} from './planning'
import {applicationInspector} from './da-inspector'
import {createContextViews} from './context-ui'
import manifest from '../data/geo/manifest.json'

const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!
const iconNodes={land:LandPlot,info:Info,search:Search,chevron:ChevronDown,frame:Scan,layers:Layers,close:X,map:MapIcon,pin:MapPin,arrow:ArrowRight,back:ChevronLeft,globe:Globe}
function icons(){for(const el of document.querySelectorAll<HTMLElement>('[data-icon]:empty')){const ic=iconNodes[el.dataset.icon as keyof typeof iconNodes];if(ic)el.append(createElement(ic,{'aria-hidden':'true','stroke-width':1.7}))}}
const sel=$('#selection'),division=$<HTMLSelectElement>('#division'),dialog=$<HTMLDialogElement>('#sourceDialog'),layerBtn=$<HTMLButtonElement>('#layerBtn'),menu=$<HTMLElement>('#layerMenu')
let map:AtlasMap|undefined,area:Item|undefined,block:Item|undefined,building:Item|undefined,home:Item|undefined,streetName='',profileMode=['localhost','127.0.0.1','[::1]'].includes(location.hostname)?'local':'example',query=''
const layers=loadLayers(name=>map?.refreshLayer(name))
const d=layers.data
const daInspector=applicationInspector($('.mapArea'))
const contextViews=createContextViews()
const layerLabels:Record<LayerName,string>={border:'ACT border',urban:'urban extent',divisions:'suburb boundaries',blocks:'registered blocks',addresses:'addresses',footprints:'building footprints',units:'unit polygons'}
const overviewStatus=document.createElement('div')
sel.before(overviewStatus)
const isKingston=()=>area?.properties.DIVISION_NAME==='KINGSTON'
let detailRequest:Promise<void>|undefined
let pendingRoute:{params:URLSearchParams;camera?:Camera}|undefined
let pointOptions:Item[]=[]
const compare=new Intl.Collator('en-AU',{numeric:true,sensitivity:'base'}).compare
function options(el:HTMLSelectElement,items:[string,string][],placeholder:string,value=''){
 el.replaceChildren(new Option(placeholder,''),...items.map(([id,label])=>new Option(label,id)));el.value=value
}
let restoring=false,fullTerritory=false
function currentUrl(){if(restoring)return;pendingRoute=undefined;const params=new URLSearchParams();if(area)params.set('suburb',String(area.properties.DIVISION_NAME));if(block)params.set('block',String(block.properties.BLOCK_KEY));if(home)params.set('address',String(home.properties.ADDRESS_ID));if(building)params.set('building',String(building.properties.OBJECTID));if(streetName&&!home)params.set('street',streetName);if(fullTerritory)params.set('view','territory');if(pointOptions.length)params.set('points',pointOptions.map(f=>f.properties.ADDRESS_ID).join(','));const path=location.pathname+(params.size?'?'+params:'');if(path!==location.pathname+location.search)history.pushState({},'',path)}
function initSources(){
 $('#sourceList').innerHTML=manifest.layers.map(row=>'<h3>'+esc(row.title)+'</h3><p>'+esc(row.coverage)+' <a href="'+esc(row.dataSource.sourceUrl)+'" target="_blank" rel="noopener">'+esc(row.dataSource.publisher)+'</a> · <a href="'+esc(row.dataSource.licenceUrl)+'" target="_blank" rel="noopener">'+esc(row.dataSource.licence)+'</a></p>').join('')+'<h3>Street basemap</h3><p><a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> Positron · OpenMapTiles · © OpenStreetMap contributors.</p>'
 $('#sourcesBtn').onclick=()=>dialog.showModal();$('#closeDialog').onclick=()=>dialog.close()
 dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}}
 layerBtn.onclick=()=>{menu.hidden=!menu.hidden;layerBtn.setAttribute('aria-expanded',String(!menu.hidden))}
}
function miniature(){
 const canvas=$<HTMLCanvasElement>('#mini');if(!canvas)return
 const ctx=canvas.getContext('2d');if(!ctx)return
 const king=d.divisions.features.find(f=>f.properties.DIVISION_NAME==='KINGSTON')
 if(!king)return
 const [[west,south],[east,north]]=bounds(king)
 const w=640,h=200;canvas.width=w;canvas.height=h
 const scale=w/(east-west)*1.9,sy=scale/Math.cos(35.3*Math.PI/180)
 ctx.fillStyle='#dbe4cd';ctx.fillRect(0,0,w,h)
 for(const [features,color,line] of [[d.urban.features,'#cddbbd','#b4c2a9'],[d.divisions.features,'#dce6cf','#b8c5af'],[[king],'#b6c8a4','#819578']] as const){
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
function overview(territory=false){
 fullTerritory=territory;area=undefined;resetSpecific();division.value='';currentUrl();map?.overview()
 if(territory)map?.territory()
 render()
}
function chooseDivision(name:string,loadDetail=true){
 if(!name){overview();return}
 const found=d.divisions.features.find(f=>f.properties.DIVISION_NAME===name)
 if(!found)return
 fullTerritory=false;area=found;division.value=name;resetSpecific();currentUrl();map?.division(found)
 if(loadDetail&&isKingston())void ensureKingston()
 render()
}
function chooseBlock(id:number){pointOptions=[];block=d.blocks.features.find(f=>f.properties.BLOCK_KEY===id);home=undefined;building=undefined;streetName='';query='';currentUrl();map?.select(block);render()}
function chooseHome(id:number){
 const a=d.addresses.features.find(f=>f.properties.ADDRESS_ID===id);if(!a)return
 pointOptions=[];home=a;streetName=street(a);block=d.blocks.features.find(f=>f.properties.BLOCK_KEY===a.properties.BLOCK_KEY);building=undefined
 currentUrl();map?.select(block,home,matchUnit(home,d.units.features,d.addresses.features));render()
}
function chooseMappedAddresses(ids:number[]){
 if(ids.length===1){chooseHome(ids[0]);return}
 resetSpecific()
 const selected=new Set(ids)
 pointOptions=d.addresses.features.filter(f=>selected.has(Number(f.properties.ADDRESS_ID))).sort((a,b)=>compare(address(a),address(b)))
 const first=pointOptions[0]
 if(first && pointOptions.every(f=>f.properties.BLOCK_KEY===first.properties.BLOCK_KEY))block=d.blocks.features.find(b=>b.properties.BLOCK_KEY===first.properties.BLOCK_KEY)
 currentUrl();map?.select(block);render();$('#mappedAddresses')?.focus({preventScroll:true})
}
function chooseBuilding(id:number){pointOptions=[];const f=d.footprints.features.find(x=>x.properties.OBJECTID===id);if(!f)return;building=f;block=d.blocks.features.find(b=>b.properties.cadastreKey===f.properties.cadastreKey);home=undefined;streetName='';query='';currentUrl();map?.select(block,undefined,undefined,building);render()}
function record():string {
 if(!home)return ''
 const p=home.properties,u=matchUnit(home,d.units.features,d.addresses.features)
 return '<section class="record"><div class="smallcap">Property record</div><h3>'+esc(address(home))+'</h3><p class="bodyText">Kingston, ACT</p>'+facts([['ACT address ID',p.ADDRESS_ID],['Registered block',block?'Block '+block.properties.BLOCK_NUMBER+', section '+block.properties.SECTION_NUMBER:'Unavailable'],['Block key',p.BLOCK_KEY],['Unit plan',p.UNITPLAN_NO],['Unit title',p.UNIT_TITLE],['Unit geometry',u?'Exact match · ACT unit '+u.properties.ID:'Unavailable']])+'<label class="field">Profile data<select id="mode"><option value="local">Private local profile</option><option value="example">Synthetic example</option></select></label><div id="profile"></div></section>'
}
function layerStatus(names:readonly LayerName[],busy:boolean,retryId:string,label:string){
 const missing=names.filter(name=>!layers.ready.has(name))
 if(!missing.length)return ''
 return '<div class="layerStatus"><p class="notice" role="status">'+(busy?'Loading '+label+'…':'These layers are unavailable. '+missing.map(name=>layerLabels[name]).join(', ')+'.')+'</p>'+
   (busy?'':'<button class="retry" id="'+retryId+'">Retry '+label+'</button>')+'</div>'
}
function renderDrill(){
 const addresses=block?d.addresses.features.filter(a=>a.properties.BLOCK_KEY===block!.properties.BLOCK_KEY):d.addresses.features
 const streets=[...new Set(addresses.map(street))].sort(compare)
 const matched=streetName?addresses.filter(a=>street(a)===streetName).sort((a,b)=>compare(unit(a),unit(b))):[]
 const buildings=block?d.footprints.features.filter(f=>f.properties.cadastreKey===block!.properties.cadastreKey):d.footprints.features
 sel.innerHTML='<hr class="sectionLine"><div class="smallcap">Kingston property explorer</div>'+layerStatus(kingstonLayers,!!detailRequest,'retryKingston','Kingston layers')+(pointOptions.length?'<label class="field">Addresses at this location<select id="mappedAddresses"></select></label>':'')+'<label class="field">Find an address<input type="search" id="addressSearch" placeholder="Street, unit or ACT address ID" autocomplete="off" value="'+esc(query)+'"></label><div id="results"></div><label class="field">Registered block<select id="blocks"></select></label><label class="field">Street address<select id="streets"></select></label>'+(matched.length?'<label class="field">Address or unit<select id="addresses"></select></label>':'')+
 (block?'<div class="record"><div class="smallcap">Registered block</div>'+facts([['Block key',block.properties.BLOCK_KEY],['Area',block.properties.BLOCK_DERIVED_AREA?Number(block.properties.BLOCK_DERIVED_AREA).toLocaleString()+' m²':'Unavailable'],['Address records',layers.ready.has('addresses')?addresses.length:'Unavailable'],['Building footprints',layers.ready.has('footprints')?buildings.length:'Unavailable']])+'</div>':'')+
 '<details '+(building?'open':'')+'><summary class="notice">Building footprints ('+(layers.ready.has('footprints')?buildings.length:'unavailable')+')</summary><label class="field">Official footprint<select id="footprints"></select></label>'+(building?facts([['Footprint ID',building.properties.ID],['Building type',title(building.properties.BUILDING_TYPE)],['Source use',title(building.properties.USE_DESCRIPTION)],['Block join',block?'Exact cadastral key':'Unavailable']]):'')+'</details>'+record()+
 (block||home?'<section class="planning" aria-labelledby="planningTitle"><h2 id="planningTitle">Planning</h2><div id="planningContent"></div></section>':'')
 const retry=$<HTMLButtonElement>('#retryKingston');if(retry)retry.onclick=()=>{void ensureKingston();render()}
 if(pointOptions.length){const el=$<HTMLSelectElement>('#mappedAddresses');options(el,pointOptions.map(f=>[String(f.properties.ADDRESS_ID),address(f)+' / '+f.properties.ADDRESS_ID]),'Choose an address ('+pointOptions.length+' records)');el.onchange=()=>{if(el.value)chooseHome(+el.value)}}
 const blocks=$<HTMLSelectElement>('#blocks')
 blocks.disabled=!layers.ready.has('blocks')
 options(blocks,d.blocks.features.map(f=>[String(f.properties.BLOCK_KEY),'Section '+f.properties.SECTION_NUMBER+' · Block '+f.properties.BLOCK_NUMBER] as [string,string]).sort((a,b)=>compare(a[1],b[1])),'All Kingston blocks',block?String(block.properties.BLOCK_KEY):'')
 blocks.onchange=()=>{if(blocks.value)chooseBlock(+blocks.value);else chooseDivision('KINGSTON')}
 const st=$<HTMLSelectElement>('#streets');st.disabled=!streets.length;options(st,streets.map(s=>[s,s]),streets.length?'Choose a street address':layers.ready.has('addresses')?'No addresses available':'Address layer unavailable',streetName)
 st.onchange=()=>{streetName=st.value;home=undefined;const choices=addresses.filter(a=>street(a)===streetName);if(choices.length===1)chooseHome(Number(choices[0].properties.ADDRESS_ID));else{currentUrl();map?.select(block);render()}}
 if(matched.length){const el=$<HTMLSelectElement>('#addresses');options(el,matched.map(f=>[String(f.properties.ADDRESS_ID),(unit(f)?'Unit '+unit(f):'Street address')+' · '+f.properties.ADDRESS_ID]),'Choose an address record',home?String(home.properties.ADDRESS_ID):'');el.onchange=()=>{if(el.value)chooseHome(+el.value);else{home=undefined;currentUrl();map?.select(block);render()}}}
 const fp=$<HTMLSelectElement>('#footprints');fp.disabled=!layers.ready.has('footprints');options(fp,buildings.map(f=>[String(f.properties.OBJECTID),f.properties.ID+' · '+title(f.properties.USE_DESCRIPTION)]),'Choose a footprint',building?String(building.properties.OBJECTID):'');fp.onchange=()=>{if(fp.value)chooseBuilding(+fp.value);else{building=undefined;currentUrl();map?.select(block,home,home&&matchUnit(home,d.units.features,d.addresses.features));render()}}
 const input=$<HTMLInputElement>('#addressSearch'),results=$('#results')
 function search(){query=input.value;results.replaceChildren();if(!query.trim())return
 const q=query.trim().toLowerCase();const hits=d.addresses.features.filter(f=>address(f).toLowerCase().includes(q)||String(f.properties.ADDRESS_ID)===q).sort((a,b)=>compare(address(a),address(b))).slice(0,25)
 if(!hits.length){results.textContent='No matching addresses.';return}
 const choices=document.createElement('select');choices.setAttribute('aria-label','Address search results');choices.className='searchResults';options(choices,hits.map(f=>[String(f.properties.ADDRESS_ID),address(f)+' · '+f.properties.ADDRESS_ID]),'Choose a result ('+hits.length+(hits.length===25?' shown':'')+')');choices.onchange=()=>{if(choices.value){query='';chooseHome(+choices.value)}};results.append(choices)
 }
 input.disabled=!layers.ready.has('addresses');input.oninput=search;search()
 if(home){const m=$<HTMLSelectElement>('#mode');m.value=profileMode;const update=()=>{profileMode=m.value;showProfile($('#profile'),home!,profileMode)};m.onchange=update;update()}
 const planning=$('#planningContent')
 if(planning)showPlanning(planning,block,home,(matches,list)=>{
   map?.showApplicationBlocks(matches)
   daInspector.setBlocks(matches,d.blocks.features,list)
 })
 else map?.showApplicationBlocks(new Map())
}
function render(){
 daInspector.close()
 const name=area?title(area.properties.DIVISION_NAME):''
 $('#panelTitle').textContent=name||'Explore Canberra';$('#panelIntro').textContent=!area?'Browse suburb boundaries and explore property detail in Kingston.':name==='Kingston'?'Explore property records and local conditions.':'Explore the official division boundary for '+name+'.'
 $('#place').textContent='Canberra  /  '+(fullTerritory?'ACT border':name||'Overview')
 contextViews.setKingston(isKingston())
 if(name==='Kingston')renderDrill()
 else{
   sel.innerHTML=(area?'<hr class="sectionLine"><div class="smallcap">Division record</div>'+facts([['Division code',area.properties.DIVISION_CODE],['Property detail','Kingston only']]):'')+card()+legend()+'<button class="back territoryBtn" id="territory"><i data-icon="globe"></i> View full ACT border</button>'
   const focus=$<HTMLButtonElement>('#focusKingston'),territory=$<HTMLButtonElement>('#territory')
   focus.disabled=!layers.ready.has('divisions');focus.onclick=()=>chooseDivision('KINGSTON')
   territory.disabled=!layers.ready.has('border');territory.onclick=()=>overview(true)
   miniature()
 }
 icons()
}
function applyHistory(enterArea:boolean){
 const route=pendingRoute
 if(!route)return
 const {params,camera}=route
 const suburb=params.get('suburb')
 const territory=params.get('view')==='territory'
 restoring=true
 try{
   if(enterArea){
     const priorKingston=isKingston()
     if(suburb&&d.divisions.features.some(f=>f.properties.DIVISION_NAME===suburb))chooseDivision(suburb,!priorKingston)
     else overview(territory)
   }
   if(suburb&&!layers.ready.has('divisions') || territory&&!layers.ready.has('border'))return
   if(isKingston()){
     const needsAddresses=params.has('address')||params.has('points')||params.has('street')
     const required:LayerName|undefined=needsAddresses?'addresses':params.has('building')?'footprints':params.has('block')?'blocks':undefined
     if(required&&!layers.ready.has(required)){
       if(!block&&params.has('block')&&layers.ready.has('blocks'))chooseBlock(Number(params.get('block')))
       return
     }
     if(params.has('address'))chooseHome(Number(params.get('address')))
     else if(params.has('building'))chooseBuilding(Number(params.get('building')))
     else if(params.has('points'))chooseMappedAddresses(params.get('points')!.split(',').map(Number))
     else{
       if(params.has('block')&&!layers.ready.has('blocks'))return
       if(params.has('block'))chooseBlock(Number(params.get('block')))
       if(params.has('street')){streetName=params.get('street')!;render()}
     }
   }
   pendingRoute=undefined
 }finally{
   if(camera)map?.restoreCamera(camera)
   restoring=false
 }
}

function ensureKingston(){
 if(detailRequest||kingstonLayers.every(name=>layers.ready.has(name)))return detailRequest
 detailRequest=layers.ensure(kingstonLayers).then(()=>{
   detailRequest=undefined
   if(!isKingston())return
   applyHistory(false)
   const addressBlock=home??pointOptions[0]
   if(addressBlock&&pointOptions.every(f=>f.properties.BLOCK_KEY===addressBlock.properties.BLOCK_KEY)){
     block=d.blocks.features.find(f=>f.properties.BLOCK_KEY===addressBlock.properties.BLOCK_KEY)
   }else if(building){
     block=d.blocks.features.find(f=>f.properties.cadastreKey===building?.properties.cadastreKey)
   }
   const matchedUnit=home&&matchUnit(home,d.units.features,d.addresses.features)
   if(block||home||building)map?.select(block,home,matchedUnit,building,false)
   render()
 })
 return detailRequest
}

function renderOverviewStatus(busy:boolean){
 overviewStatus.innerHTML=layerStatus(overviewLayers,busy,'retryOverview','overview layers')
 const retry=$<HTMLButtonElement>('#retryOverview')
 if(retry)retry.onclick=()=>void ensureOverview()
}

async function ensureOverview(){
 renderOverviewStatus(true)
 await layers.ensure(overviewLayers)
 options(division,d.divisions.features.map(f=>[String(f.properties.DIVISION_NAME),title(f.properties.DIVISION_NAME)] as [string,string]).sort((a,b)=>compare(a[1],b[1])),'Choose a suburb',String(area?.properties.DIVISION_NAME??''))
 division.disabled=!layers.ready.has('divisions')
 renderOverviewStatus(false)
 if(pendingRoute)applyHistory(true)
 else if(map)render()
}

async function init(){
 icons();initSources();division.disabled=true
 await ensureOverview()
 try{map=attachMap(d,{division:chooseDivision,block:chooseBlock,addresses:chooseMappedAddresses,footprint:chooseBuilding,application:daInspector.show,closeApplication:daInspector.close})}catch{$('#status').textContent='Map rendering is unavailable. Use the suburb and property controls to explore the records.'}
 division.onchange=()=>chooseDivision(division.value);$('#overview').onclick=()=>overview()
 function restore(){
   pendingRoute={params:new URLSearchParams(location.search),camera:history.state?.camera as Camera|undefined}
   applyHistory(true)
 }
 map?.onCamera(()=>{if(!restoring)history.replaceState({camera:map?.camera()},'')})
 addEventListener('popstate',restore)
 restore()
}
void init().catch(()=>{$('#status').textContent='Official map layers could not load. Refresh to retry.'})

