// Compile the DOM component
// crate separately from numeric kernels; generated bindings contain no app logic.
import {mkdir,readFile,writeFile,access} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {homedir} from 'node:os'
import {resolve,dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
// 0.2.105 fixes retained JS handles when Rust closures are dropped (#4709).
const version='0.2.105',rust='1.99.0'
const platforms={
 'win32-x64':{name:'x86_64-pc-windows-msvc',sha:'f70f9439437b0bb856367d70ac747e42116cb5a6f8a603656ccc93ce02c40bf8',bytes:7278855},
 'linux-x64':{name:'x86_64-unknown-linux-musl',sha:'b391448c4926ac4b11425a6752484d85164e72489d97804461d5e868c643b88a',bytes:8815954}
}
const run=(command,args,options={})=>{
 const result=spawnSync(command,args,{cwd:root,windowsHide:true,encoding:'utf8',...options})
 if(result.error)throw result.error
 if(result.status!==0)throw Error(`${command} failed (${result.status}): ${result.stderr||''}`)
 return result.stdout?.trim()
}
async function bindgen(){
 if(process.env.WASM_BINDGEN)return process.env.WASM_BINDGEN
 const platform=platforms[`${process.platform}-${process.arch}`]
 if(!platform)throw Error(`Set WASM_BINDGEN to wasm-bindgen ${version} on this platform`)
 const name=`wasm-bindgen-${version}-${platform.name}`,cache=join(process.env.CARGO_HOME||join(homedir(),'.cargo'),'inhouse-tools',name)
 const executable=join(cache,name,process.platform==='win32'?'wasm-bindgen.exe':'wasm-bindgen')
 try{await access(executable);return executable}catch{}
 await mkdir(cache,{recursive:true})
 const archive=join(cache,`${name}.tar.gz`)
 let bytes=await readFile(archive).catch(()=>null)
 const valid=data=>data?.length===platform.bytes&&createHash('sha256').update(data).digest('hex')===platform.sha
 if(!valid(bytes)){
  const response=await fetch(`https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${version}/${name}.tar.gz`)
  if(!response.ok)throw Error(`wasm-bindgen download HTTP ${response.status}`)
  bytes=Buffer.from(await response.arrayBuffer())
  if(!valid(bytes))throw Error('wasm-bindgen archive size/SHA256 mismatch')
  await writeFile(archive,bytes)
 }
 run('tar',['-xzf',archive,'-C',cache])
 return executable
}
const cli=await bindgen()
if(run(cli,['--version'])!==`wasm-bindgen ${version}`)throw Error(`wasm-bindgen ${version} required`)
const cargo=process.env.CARGO||'cargo',env={...process.env}
const target=resolve(process.env.CARGO_UI_TARGET_DIR||resolve(root,'rust-ui/target'))
env.CARGO_TARGET_DIR=target
const toolchain=process.env.RUST_UI_TOOLCHAIN||(process.platform==='win32'?`${rust}-x86_64-pc-windows-gnu`:null)
const args=toolchain?[`+${toolchain}`]:[]
if(process.platform==='win32'&&toolchain?.endsWith('windows-gnu')){
 const rustup=process.env.RUSTUP||join(dirname(cargo),process.env.CARGO?'rustup.exe':'rustup')
 const rustc=run(rustup,['which','--toolchain',toolchain,'rustc'])
 const sysroot=run(rustc,['--print','sysroot'])
 env.CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=join(sysroot,'lib/rustlib/x86_64-pc-windows-gnu/bin/rust-lld.exe')
 env.CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS='-C linker-flavor=gnu-lld -C link-self-contained=yes'
}
// Only the UI module uses this smaller stack. Numeric/voice kernels retain
// their own independently built memories and stack requirements.
const inherited=env.CARGO_ENCODED_RUSTFLAGS?.split('\x1f')??env.RUSTFLAGS?.split(/\s+/).filter(Boolean)??[]
// Keep the established JS-heap ABI on both sides. With stripped metadata,
// rustc's default reference-types would make the live counter read an unused
// WASM slab. Enabling automatic multivalue also leaks result slots on errors
// in the pinned bindgen version. Positive lifetime controls cover this choice.
env.CARGO_ENCODED_RUSTFLAGS=[...inherited,'-C','target-feature=-reference-types,-multivalue','-C','link-arg=-zstack-size=262144',
 '--remap-path-prefix=src\\lib.rs=lib.rs','--remap-path-prefix=src/lib.rs=lib.rs'].join('\x1f')
run(cargo,[...args,'build','--manifest-path',resolve(root,'rust-ui/Cargo.toml'),'--release','--target','wasm32-unknown-unknown','--locked'],{env,stdio:'inherit'})
const output=resolve(root,'src/wasm/ui')
await mkdir(output,{recursive:true})
run(cli,['--target','web','--remove-name-section','--out-dir',output,join(target,'wasm32-unknown-unknown/release/inhouse_read_ui.wasm')],{stdio:'inherit'})
const bytes=await readFile(join(output,'inhouse_read_ui_bg.wasm'))
console.log(`Rust UI: ${bytes.length} bytes; SHA256 ${createHash('sha256').update(bytes).digest('hex')}`)
