import { spawn, spawnSync } from 'node:child_process'

// Optional Playwright global setup for a shared machine: with BROWSER_LOCK=<file> the run waits for
// an exclusive flock on that file and holds it until teardown, so only one software-GL browser
// run measures at a time; BROWSER_NICE=<n> renices the runner (and the browsers it starts later).
export default async function browserLock() {
  if (process.env.BROWSER_NICE) spawnSync('renice', ['-n', process.env.BROWSER_NICE, '-p', String(process.pid)])
  const file = process.env.BROWSER_LOCK
  if (!file) return undefined
  const holder = spawn('flock', [file, 'sh', '-c', 'echo locked; exec cat'], { stdio:['pipe', 'pipe', 'inherit'] })
  await new Promise((resolve, reject) => {
    holder.stdout.once('data', resolve)
    holder.once('exit', code => reject(new Error(`flock ${file} exited (${code})`)))
  })
  return async () => { holder.stdin.end(); }
}
