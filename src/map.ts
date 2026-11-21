import {Map as GLMap, Marker, ScaleControl,NavigationControl,AttributionControl,setWorkerUrl,type LayerSpecification,type StyleSpecification,type GeoJSONSource} from 'maplibre-gl'
import workerURL from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {bounds, type Dataset,type Item,type LayerName} from './data'
setWorkerUrl(workerURL)
export type Camera={center:[number,number];zoom:number;bearing:number;pitch:number}
const names:Record<LayerName,string>={border:'ACT border',urban:'Urban extent · ABS 2021',divisions:'Suburb boundaries',blocks:'Registered blocks',footprints:'Building footprints',addresses:'Address points',units:'Matched unit polygon'}
const groups:Record<LayerName,string[]>={border:['territory'],urban:['urban-fill'],divisions:['div-fill','div-line'],blocks:['block-fill','block-line'],footprints:['building-fill'],addresses:['address-point'],units:['unit-fill','unit-line']}
const empty={type:'FeatureCollection' as const,features:[]}
export function attachMap(data:Dataset, events:{division:(name:string)=>void;block:(id:number)=>void;addresses:(ids:number[])=>void;footprint:(id:number)=>void}) {
 const map=new GLMap({container:'map',center:[149.09,-35.33],zoom:10.5,minZoom:5,maxZoom:21,attributionControl:false,canvasContextAttributes:{antialias:true},style:{version:8,glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',sources:{},layers:[{id:'paper',type:'background',paint:{'background-color':'#e7ebdf'}}]}})
 map.addControl(new NavigationControl({showCompass:true,visualizePitch:false}),'bottom-right')
 map.addControl(new ScaleControl({unit:'metric',maxWidth:88}),'bottom-left')
 map.addControl(new AttributionControl({compact:true,customAttribution:'© ACTmapi · ABS | <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}),'bottom-right')
 let ready=false,kingston=false
 const active=new Set<LayerName>(Object.keys(names) as LayerName[])
 const menu=document.querySelector('#layerMenu')!
 for(const key of Object.keys(names) as LayerName[]){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.checked=true;box.onchange=()=>{if(box.checked)active.add(key);else active.delete(key);visibility()};label.append(box,names[key]);menu.append(label)}
 const drill=new Set(['blocks','addresses','footprints','units'])
 function visibility(){if(!ready)return;for(const key of Object.keys(names) as LayerName[])for(const id of groups[key])map.setLayoutProperty(id,'visibility',active.has(key)&&(!drill.has(key)||kingston)?'visible':'none')}
 const local=(spec:LayerSpecification)=>map.addLayer(spec)
 const point=(f:Item)=>{const [[a,b],[c,d]]=bounds(f);return [(a+c)/2,(b+d)/2] as [number,number]}
 const capital=document.createElement('div');capital.className='mapLabel capital';capital.textContent='Canberra'
 const cityMarker=new Marker({element:capital,anchor:'bottom'}).setLngLat([149.129,-35.279])
 const pin=document.createElement('button');pin.className='markerBtn';pin.textContent='●  Kingston';pin.setAttribute('aria-label','Explore Kingston');pin.onclick=()=>events.division('KINGSTON')
 const kMarker=new Marker({element:pin,anchor:'left'})
 const kingstonDivision=()=>data.divisions.features.find(f=>f.properties.DIVISION_NAME==='KINGSTON')
 function updateMarkers(){
   const k=kingstonDivision()
   if(map.getZoom()<12 && !kingston){
     cityMarker.addTo(map)
     if(k)kMarker.setLngLat(point(k)).addTo(map)
   }else{
     cityMarker.remove()
     kMarker.remove()
   }
 }
 function fit(f:Item,maxZoom=16){map.fitBounds(bounds(f),{padding:window.innerWidth<730?28:52,maxZoom,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:430})}
 let selected:Partial<Record<'area'|'parcel'|'home'|'unit'|'building',Item|undefined>>={}
 function sync(){if(!ready)return;for(const id of ['area','parcel','home','unit','building'] as const){const f=selected[id];(map.getSource('sel-'+id) as GeoJSONSource).setData(f||empty)}}
 map.once('load',()=>{
   for(const key of Object.keys(data) as LayerName[])map.addSource(key,{type:'geojson',data:data[key]})
   for(const id of ['area','parcel','home','unit','building'])map.addSource('sel-'+id,{type:'geojson',data:empty})
   local({id:'urban-fill',type:'fill',source:'urban',paint:{'fill-color':'#96b281','fill-opacity':.28}})
   local({id:'div-fill',type:'fill',source:'divisions',paint:{'fill-color':'#b2cbae','fill-opacity':.12}})
   local({id:'div-line',type:'line',source:'divisions',paint:{'line-color':'#708d73','line-opacity':.8,'line-width':1}})
   local({id:'territory',type:'line',source:'border',paint:{'line-color':'#486849','line-width':2.4,'line-dasharray':[4,2]}})
   local({id:'selected-area',type:'line',source:'sel-area',paint:{'line-color':'#a34b30','line-width':2.2}})
   local({id:'block-fill',type:'fill',source:'blocks',paint:{'fill-color':'#e8d4a2','fill-opacity':.45}})
   local({id:'block-line',type:'line',source:'blocks',paint:{'line-color':'#84734b','line-width':1}})
   local({id:'building-fill',type:'fill',source:'footprints',paint:{'fill-color':'#758877','fill-opacity':.65,'fill-outline-color':'#536b59'}})
   local({id:'chosen-block',type:'line',source:'sel-parcel',paint:{'line-color':'#a64a2c','line-width':3}})
   local({id:'chosen-building',type:'line',source:'sel-building',paint:{'line-color':'#374b78','line-width':3}})
   local({id:'unit-fill',type:'fill',source:'sel-unit',paint:{'fill-color':'#bd532b','fill-opacity':.45}})
   local({id:'unit-line',type:'line',source:'sel-unit',paint:{'line-color':'#a53f20','line-width':2.5}})
   local({id:'address-point',type:'circle',source:'addresses',minzoom:15,paint:{'circle-radius':['interpolate',['linear'],['zoom'],15,2.5,19,5],'circle-color':'#934731','circle-stroke-color':'#fffaf0','circle-stroke-width':1}})
   local({id:'chosen-home',type:'circle',source:'sel-home',paint:{'circle-radius':7,'circle-color':'#aa472b','circle-stroke-width':3,'circle-stroke-color':'#fffdf5'}})
   ready=true;visibility();sync();updateMarkers()
   void addBasemap()
 })
 async function addBasemap(){
   try {
     const response=await fetch('https://tiles.openfreemap.org/styles/positron',{signal:AbortSignal.timeout(4500)})
     if(!response.ok)return
     const style:StyleSpecification=await response.json()
     for(const [id,source] of Object.entries(style.sources))map.addSource(id,source)
     for(const layer of style.layers){
       if(layer.type==='background')continue
       if(layer.type==='symbol' && layer.layout?.['icon-image']) continue
       if(layer.type==='fill' && layer.paint?.['fill-pattern'])continue
       map.addLayer(layer,'urban-fill')
     }
   }catch{/* The local map remains usable when basemap requests fail. */}
 }
 map.on('mouseenter','div-fill',()=>{map.getCanvas().style.cursor='pointer'})
 map.on('mouseleave','div-fill',()=>{map.getCanvas().style.cursor=''})
 map.on('zoomend',updateMarkers)
 map.on('click',e=>{
   if(!ready)return
   const hit=map.queryRenderedFeatures(e.point,{layers:['address-point','building-fill','block-fill','div-fill']})
   const first=hit[0];if(!first)return
   if(kingston && first.layer.id==='address-point')events.addresses([...new Set(hit.filter(f=>f.layer.id==='address-point').map(f=>Number(f.properties.ADDRESS_ID)))])
   else if(kingston && first.layer.id==='building-fill')events.footprint(Number(first.properties.OBJECTID))
   else if(kingston && first.layer.id==='block-fill')events.block(Number(first.properties.BLOCK_KEY))
   else if(first.layer.id==='div-fill')events.division(first.properties.DIVISION_NAME)
 })
 function overview(){
   kingston=false;selected={};sync();visibility()
   if(data.urban.features[0])fit(data.urban.features[0],11)
   else map.jumpTo({center:[149.09,-35.33],zoom:10.5,pitch:0,bearing:0})
   updateMarkers()
 }
 overview()
 const camera=():Camera=>({center:map.getCenter().toArray() as [number,number],zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()})
 return {
   overview,
   camera,
   restoreCamera:(saved:Camera)=>map.jumpTo(saved),
   onCamera:(handler:()=>void)=>map.on('moveend',handler),
   refreshLayer(name: LayerName){
     if(ready)(map.getSource(name) as GeoJSONSource).setData(data[name])
     if(name==='divisions' && ready)updateMarkers()
   },
   division(f:Item){kingston=f.properties.DIVISION_NAME==='KINGSTON';selected={area:f};sync();visibility();fit(f);updateMarkers()},
   select(block?:Item,address?:Item,unit?:Item,building?:Item,move=true){
     selected={area:kingstonDivision(),parcel:block,home:address,unit,building};sync()
     const f=unit||building||block||address;if(f && move)fit(f,address?18:17)
   },
   territory(){if(data.border.features[0])fit(data.border.features[0],10)},
 }
}
export type AtlasMap=ReturnType<typeof attachMap>

