//! Shared fitted geometry and mounting-surface composition. The numeric packing
//! stays in the placement core; this owns the floor/ceiling routing and snapshot.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Object,Reflect};
use crate::host::{read,method,call,num,truthy,absent};
use crate::cloud_host::object;
use crate::jsmath::{jmax,jmin};
type R<T> = Result<T,JsValue>;
fn number(value:f64)->JsValue{JsValue::from_f64(value)}
fn optional(target:&JsValue,key:&str)->R<JsValue>{if absent(target){Ok(JsValue::UNDEFINED)}else{read(target,key)}}
fn fallback(value:JsValue,default:impl FnOnce()->R<JsValue>)->R<JsValue>{if absent(&value){default()}else{Ok(value)}}

#[wasm_bindgen]
pub fn plant_geometry_spec(entry:JsValue,host:JsValue)->R<JsValue>{
    let plant=method(&host,"resolveCatalogPlant",&[&entry])?;
    let pot=method(&host,"getCatalogPot",&[&read(&entry,"potId")?])?;
    let pot_id=fallback(optional(&pot,"id")?,||fallback(read(&plant,"defaultPotId")?,||Ok(JsValue::NULL)))?;
    let pot=method(&host,"getCatalogPot",&[&pot_id])?;
    let model=optional(&pot,"modelId")?;let model=if truthy(&model){model}else{pot_id.clone()};
    let real=method(&host,"plantDimensions",&[&read(&plant,"id")?,&pot_id])?;
    let height=num(&read(&entry,"height")?);
    let height=jmax(1.0,if height==0.0||height.is_nan(){num(&read(&real,"height")?)*0.5}else{height});
    let unit=height/num(&read(&real,"height")?);
    Ok(object(&[("catalogPlant",plant),("potId",pot_id),("potModelId",model),("real",real),("height",number(height)),("unit",number(unit))]))
}
#[wasm_bindgen]
pub fn lamp_geometry_spec(options:JsValue,host:JsValue)->R<JsValue>{
    let id=read(&options,"lampId")?;let id=if id.is_undefined(){"tarnaby".into()}else{id};
    let width=read(&options,"width")?;let height=read(&options,"height")?;
    let lamp=method(&host,"getCatalogLamp",&[&id])?;
    let lamp=if truthy(&lamp){lamp}else{method(&host,"getCatalogLamp",&[&"tarnaby".into()])?};
    let native=read(&lamp,"dimensions")?;
    let width_scale=if width.as_f64().is_some_and(|n|n.is_finite()&&n>0.0){num(&width)/num(&read(&native,"width")?)}else{1.0};
    let height_scale=if height.as_f64().is_some_and(|n|n.is_finite()&&n>0.0){num(&height)/num(&read(&native,"height")?)}else{f64::INFINITY};
    let id=read(&lamp,"id")?;let kind=if id==JsValue::from_str("mittled"){0.0}else if id==JsValue::from_str("tripod"){1.0}else{2.0};
    Ok(object(&[("lamp",lamp),("native",native),("scale",number(jmin(width_scale,height_scale))),("kind",number(kind))]))
}

// Typed browser-property bindings avoid allocating a reflected key string for
// every object in a pointer update. These remain ordinary JS data objects.
#[wasm_bindgen]
extern "C" {
    type DecorItem;
    #[wasm_bindgen(method,getter,catch,js_name=kind)] fn item_kind(this:&DecorItem)->R<JsValue>;
    #[wasm_bindgen(method,getter,catch,js_name=mount)] fn item_mount(this:&DecorItem)->R<JsValue>;
    #[wasm_bindgen(method,getter,catch,js_name=key)] fn item_key(this:&DecorItem)->R<JsValue>;
    #[wasm_bindgen(method,getter,catch,js_name=shelf)] fn item_shelf(this:&DecorItem)->R<JsValue>;
    #[wasm_bindgen(method,getter,catch,js_name=x)] fn item_x(this:&DecorItem)->R<JsValue>;
    #[wasm_bindgen(method,setter,js_name=shelf)] fn set_shelf(this:&DecorItem,value:&JsValue);
    #[wasm_bindgen(method,setter,js_name=x)] fn set_x(this:&DecorItem,value:&JsValue);
    type PlacementRow;
    #[wasm_bindgen(method,getter,js_name=items)] fn row_items(this:&PlacementRow)->Array;
    #[wasm_bindgen(method,getter,js_name=freeWidth)] fn row_free(this:&PlacementRow)->f64;
    #[wasm_bindgen(method,getter,js_name=occupiedWidth)] fn row_occupied(this:&PlacementRow)->f64;
    #[wasm_bindgen(method,setter,js_name=items)] fn set_items(this:&PlacementRow,items:&Array);
    #[wasm_bindgen(method,setter,js_name=objects)] fn set_objects(this:&PlacementRow,items:&Array);
    #[wasm_bindgen(method,setter,js_name=usedWidth)] fn set_used(this:&PlacementRow,value:f64);
    #[wasm_bindgen(method,setter,js_name=occupiedWidth)] fn set_occupied(this:&PlacementRow,value:f64);
    #[wasm_bindgen(method,setter,js_name=freeWidth)] fn set_free(this:&PlacementRow,value:f64);
}
fn item(value:&JsValue)->&DecorItem{value.unchecked_ref::<DecorItem>()}
fn array(value:&JsValue)->R<&Array>{value.dyn_ref::<Array>().ok_or_else(||js_sys::TypeError::new("Shelf decorations must be an array").into())}
fn ceiling(value:&JsValue)->R<bool>{Ok(item(value).item_kind()?==JsValue::from_str("lamp")&&item(value).item_mount()?==JsValue::from_str("undershelf"))}
fn filter(objects:&JsValue,on_ceiling:bool)->R<JsValue>{
    let source=array(objects)?;let selected=Array::new();
    // Array.filter captures length, skips holes and observes inherited indices.
    for index in 0..source.length(){if Reflect::has(objects,&number(index as f64))?{
        let item=source.get(index);if ceiling(&item)?==on_ceiling{selected.push(&item);}
    }}
    Ok(selected.into())
}
fn join(floor:JsValue,roof:JsValue)->R<JsValue>{
    let floor=array(&floor)?;let roof=array(&roof)?;let joined=Array::new();
    for index in 0..floor.length().max(roof.length()){
        let floor_row=floor.get(index);let ceiling=roof.get(index);
        // Placement rows come from the numeric packing adapter and contain
        // only its fixed own data fields. Bulk-copy those fields once.
        let source=if truthy(&floor_row){&floor_row}else{&ceiling};
        let row=Object::assign(&Object::new(),source.unchecked_ref::<Object>());
        let row=row.unchecked_ref::<PlacementRow>();
        if !truthy(&floor_row){
            row.set_items(&Array::new());row.set_used(0.0);row.set_occupied(0.0);
            let source=source.unchecked_ref::<PlacementRow>();
            row.set_free(source.row_free()+source.row_occupied());
        }
        let floor_items=row.row_items();
        let items=if absent(&ceiling){Array::from(floor_items.as_ref())}else{
            floor_items.concat(&ceiling.unchecked_ref::<PlacementRow>().row_items())
        };
        row.set_items(&items);row.set_objects(&items);joined.push(row.as_ref());
    }
    Ok(joined.into())
}
#[wasm_bindgen]
pub fn layout_shelf_decorations(objects:JsValue,options:JsValue,layout:JsValue)->R<JsValue>{
    // Preserve completion of the first surface before inspecting the second:
    // record accessors can synchronously perform another placement operation.
    let floor=call(&layout,"layoutShelvedObjects",&[&filter(&objects,false)?,&options])?;
    let roof=call(&layout,"layoutShelvedObjects",&[&filter(&objects,true)?,&options])?;
    join(floor,roof)
}
#[wasm_bindgen]
pub fn move_shelf_decoration(objects:JsValue,key:JsValue,target:JsValue,options:JsValue,layout:JsValue,moving:JsValue)->R<JsValue>{
    let mut on_ceiling=false;let source=array(&objects)?;
    for index in 0..source.length(){let item=source.get(index);if self::item(&item).item_key()?==key{on_ceiling=ceiling(&item)?;break;}}
    let selected=filter(&objects,on_ceiling)?;let other=filter(&objects,!on_ceiling)?;
    let moved=call(&moving,"moveShelfObject",&[&selected,&key,&target,&options])?;
    let retained=call(&layout,"layoutShelvedObjects",&[&other,&options])?;
    let shelves=if on_ceiling{join(retained,read(&moved,"shelves")?)?}else{join(read(&moved,"shelves")?,retained)?};
    let positioned=Array::new();let entries=Array::new();
    for row in array(&shelves)?.iter(){for entry in row.unchecked_ref::<PlacementRow>().row_items().iter(){positioned.push(&entry);}}
    for entry in positioned.iter(){
        let entry=item(&entry);let key=entry.item_key()?;
        let position=Object::new();let record=position.unchecked_ref::<DecorItem>();
        record.set_shelf(&entry.item_shelf()?);record.set_x(&entry.item_x()?);
        entries.push(&Array::of2(&key,position.as_ref()));
    }
    let placements=Object::from_entries(entries.as_ref())?;
    Ok(object(&[("shelves",shelves),("objects",positioned.into()),("placements",placements.into())]))
}
