import type {Feature,FeatureCollection,Geometry,Position} from 'geojson'
export const files = {border:'border',urban:'urban',divisions:'divisions',blocks:'kingston-blocks',addresses:'kingston-addresses',footprints:'kingston-footprints',units:'kingston-units'} as const
export type LayerName = keyof typeof files
export type Item = Feature<Geometry,Record<string,string|number|null>>
export type Collection = FeatureCollection<Geometry,Item['properties']>
export type Dataset = Record<LayerName, Collection>
export const title = (value:unknown) => String(value ?? '').toLowerCase().replace(/\b\p{L}/gu,c=>c.toUpperCase())
export function street(f:Item) {const p=f.properties;return [p.STREET_NUMBER,title(p.STREET_NAME),title(p.STREET_TYPE)].filter(Boolean).join(' ')}
export function unit(f:Item) {return String(f.properties.DOOR_NO ?? f.properties.UNIT_TITLE ?? '')}
export function address(f:Item) {return (unit(f) ? unit(f)+'/' : '')+street(f)}
export function points(g:Geometry):Position[] {
  if(g.type==='GeometryCollection') return g.geometries.flatMap(points)
  const coordinates = g.coordinates
  if(g.type==='Point') return [coordinates as Position]
  const list:Position[]=[]
  function visit(values:unknown[]) {
    if(typeof values[0]==='number') list.push(values as Position)
    else for(const child of values) visit(child as unknown[])
  }
  visit(coordinates)
  return list
}
export function bounds(f:Item):[[number,number],[number,number]] {
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity
  for(const [x,y] of points(f.geometry)){xmin=Math.min(x,xmin);xmax=Math.max(x,xmax);ymin=Math.min(y,ymin);ymax=Math.max(y,ymax)}
  return [[xmin,ymin],[xmax,ymax]]
}
export function matchUnit(a:Item,units:Item[],addresses:Item[]) {
  const p=a.properties
  if (!p.UNITPLAN_NO || !p.UNIT_TITLE || !p.BLOCK_KEY) return
  const sameAddressKey=(f:Item) => f.properties.BLOCK_KEY===p.BLOCK_KEY && String(f.properties.UNITPLAN_NO)===String(p.UNITPLAN_NO) && String(f.properties.UNIT_TITLE)===String(p.UNIT_TITLE)
  if(addresses.filter(sameAddressKey).length!==1)return
  const matches=units.filter(f=>f.properties.BLOCK_KEY===p.BLOCK_KEY && String(f.properties.UNIT_PLAN_NO)===String(p.UNITPLAN_NO) && String(f.properties.UNIT_NUMBER)===String(p.UNIT_TITLE))
  return matches.length===1 ? matches[0] : undefined
}
export async function loadData():Promise<Dataset> {
  const entries=await Promise.all(Object.entries(files).map(async ([key,file])=>{
    const response=await fetch('/geo/'+file+'.geojson')
    if(!response.ok)throw Error(file+' unavailable')
    const json=await response.json()
    if(!Array.isArray(json.features)) throw Error(file+' is invalid')
    return [key,json] as const
  }))
  return Object.fromEntries(entries) as Dataset
}

