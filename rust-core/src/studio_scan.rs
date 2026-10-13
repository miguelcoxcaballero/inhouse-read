//! Validate a bounded chunk of the exact existing half-float studio atlas.
//! No pixel conversion: values and texture settings remain owned by the host.
#[no_mangle]
pub unsafe extern "C" fn studio_half_scan(pointer:*const u16,length:usize)->u32{
 if pointer.is_null()||length==0||length>65_536{return 0}
 let data=std::slice::from_raw_parts(pointer,length);
 // Four half words fit one unaligned MVP i64 load. Each zero exponent
 // difference denotes a non-finite half; the subtract mask detects any
 // zero 16-bit lane without converting pixels to floating-point values.
 let mask=0x7c00_7c00_7c00_7c00u64;
 let mut lit=0u64;let mut index=0;
 while index+4<=length{
  let word=std::ptr::read_unaligned(pointer.add(index).cast::<u64>());
  let difference=(word&mask)^mask;
  if difference.wrapping_sub(0x0001_0001_0001_0001)&!difference&0x8000_8000_8000_8000!=0{return 0}
  lit|=word;index+=4;
 }
 for &value in &data[index..]{
  if value&0x7c00==0x7c00{return 0}
  lit|=u64::from(value);
 }
 if lit!=0{2}else{1}
}
