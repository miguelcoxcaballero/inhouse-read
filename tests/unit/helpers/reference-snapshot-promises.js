// FROZEN copies of the four promise helpers of src/js/readers/page-snapshot.js as they were before they moved to
// rust-ui snapshot_promises.rs. They are the reference of snapshot-promises.test.js: do not edit them to follow
// production.
export function beforeDeadline(promise, deadline) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Reading image decode timed out')), Math.max(0, deadline - performance.now()))
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

export function blobDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export const localBlob = href => fetch(href).then(response => response.blob())
export const loadImage = (image, url) => new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url })
