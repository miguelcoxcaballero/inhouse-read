// Observe the existing awaited navigation without adding tasks, timers or
// alternate page-loading paths. Values contain no text, URLs or locators.
const getter = `    get inhouseReadTurnDiagnostic() {
        return {
            turnStage: this.inhouseReadTurnStage || 0,
            displayStage: this.inhouseReadDisplayStage || 0,
            sectionLoadPending: !!this.inhouseReadSectionLoadPending,
            viewLoadPending: !!this.inhouseReadViewLoadPending,
            viewReady: ({ loading: 1, interactive: 2, complete: 3 })[this.#view?.document?.readyState] || 0,
        }
    }
`;
const replacements = [
  ["    async #display(promise) {\n        const { index, src, anchor, onLoad, select } = await promise",
   "    async #display(promise) {\n        this.inhouseReadDisplayStage = 1\n        const { index, src, anchor, onLoad, select } = await promise\n        this.inhouseReadDisplayStage = 2"],
  ["            await view.load(src, afterLoad, beforeRender)",
   "            this.inhouseReadDisplayStage = 3\n            this.inhouseReadViewLoadPending = true\n            await view.load(src, afterLoad, beforeRender)\n            this.inhouseReadViewLoadPending = false\n            this.inhouseReadDisplayStage = 4"],
  ["        await this.scrollToAnchor((typeof anchor === 'function'",
   "        this.inhouseReadDisplayStage = 5\n        await this.scrollToAnchor((typeof anchor === 'function'"],
  ["        if (hasFocus) this.focusView()\n    }\n    #canGoToIndex(index)",
   "        this.inhouseReadDisplayStage = 6\n        if (hasFocus) this.focusView()\n        this.inhouseReadDisplayStage = 0\n    }\n    #canGoToIndex(index)"],
  ["            await this.#display(Promise.resolve(this.sections[index].load())\n                .then(src => ({ index, src, anchor, onLoad, select }))\n                .catch(e => {",
   "            this.inhouseReadSectionLoadPending = true\n            await this.#display(Promise.resolve(this.sections[index].load())\n                .then(src => (this.inhouseReadSectionLoadPending = false, { index, src, anchor, onLoad, select }))\n                .catch(e => {\n                    this.inhouseReadSectionLoadPending = false"],
  ["        const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))\n        if (shouldGo) await this.#goTo({",
   "        this.inhouseReadTurnStage = 1\n        const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))\n        this.inhouseReadTurnStage = 2\n        if (shouldGo) await this.#goTo({"],
  ["        if (shouldGo || !this.hasAttribute('animated')) await waitForPageCooldown(100)\n        this.#locked = false",
   "        this.inhouseReadTurnStage = 3\n        if (shouldGo || !this.hasAttribute('animated')) await waitForPageCooldown(100)\n        this.#locked = false\n        this.inhouseReadTurnStage = 0"],
  ["    getContents() {\n        if (this.#view) return [{",getter+"    getContents() {\n        if (this.#view) return [{"],
];
export function patchFoliateTurnDiagnostics(input) {
  let source = input.replaceAll('\r\n', '\n');
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('Unexpected Foliate navigation diagnostic signature; review before building.');
    source = source.replace(before, after);
  }
  return source;
}
