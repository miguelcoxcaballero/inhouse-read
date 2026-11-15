// Frozen from src/js/bookshelf-scene.js 1.7.335 (advanceLampPower, setLampPower, setLampKelvin and
// the two questions the modal and the inspection gesture asked every lamp), with the tint
// transition of src/js/lamp-kelvin.js and the core's tint_moment, tint_ease and tint_mix written
// out. `scenePower` is the frozen native step (scene_lamp_power), `tints` the host's table.
export function createLampReference({ scenePower, tints, kelvins, defaultKelvin, ms, setData, clock }) {
  const normalizeLampKelvin = value => kelvins.includes(Number(value)) ? Number(value) : defaultKelvin;
  const lampTint = kelvin => [...tints.get(normalizeLampKelvin(kelvin))];
  const createTintTransition = kelvin => {
    const state = { kelvin:normalizeLampKelvin(kelvin), from:lampTint(kelvin), to:lampTint(kelvin), value:lampTint(kelvin), started:0, duration:0 };
    return {
      state,
      set(next, now, animate) {
        const target = normalizeLampKelvin(next);
        if (target === state.kelvin) return false;
        state.kelvin = target; state.from = [...state.value]; state.to = lampTint(target);
        state.started = now; state.duration = animate ? ms : 0;
        if (!animate) state.value = [...state.to];
        return true;
      },
      moving: () => state.value[0] !== state.to[0] || state.value[1] !== state.to[1] || state.value[2] !== state.to[2],
      advance(now) {
        if (!this.moving()) return false;
        const moment = state.duration !== 0 && state.duration === state.duration ? Math.min(1, Math.max(0, (now - state.started) / state.duration)) : 1;
        let amount = 1;
        if (!(moment >= 1)) { if (moment < .5) amount = 2 * moment * moment; else { const k = -2 * moment + 2; amount = 1 - k * k / 2; } }
        for (let channel = 0; channel < 3; channel++) state.value[channel] = state.from[channel] + (state.to[channel] - state.from[channel]) * amount;
        return moment < 1;
      }
    };
  };
  const lampIo = new Float64Array(8);
  // Returns whether the lamp still moves; `dirty` is called where the scene set shelfSnapshotDirty.
  function advanceLampPower(entry, now, reduced, dirty) {
    const target = entry.isOn === false ? 0 : 1;
    const power = entry.lampPower ||= { value:target, from:target, target, started:now, duration:0 };
    let fading = false;
    if (!(power.target === target && Object.is(power.value, power.from + (target - power.from)) &&
        (reduced || power.duration === 0 || power.duration !== power.duration || (now - power.started) / power.duration >= 1))) {
      lampIo[0] = target; lampIo[1] = power.value; lampIo[2] = power.from; lampIo[3] = power.target;
      lampIo[4] = power.started; lampIo[5] = power.duration; lampIo[6] = now; lampIo[7] = reduced ? 1 : 0;
      scenePower(lampIo);
      power.value = lampIo[0]; power.from = lampIo[1]; power.target = lampIo[2]; power.started = lampIo[3]; power.duration = lampIo[4];
      fading = Boolean(lampIo[5]);
      if (lampIo[6]) dirty();
    }
    const model = entry.model, node = entry.node;
    const shown = entry.lampShown ||= { model:null, power:NaN, node:null, text:NaN, tinted:null, r:NaN, g:NaN, b:NaN };
    if (shown.model !== model || !Object.is(shown.power, power.value)) {
      shown.model = model; shown.power = power.value; model?.userData.setPower?.(power.value);
    }
    if (node && (shown.node !== node || !Object.is(shown.text, power.value))) {
      shown.node = node; shown.text = power.value; setData(node, 'lampPower', power.value.toFixed(4));
    }
    const tint = entry.lampTint ||= createTintTransition(entry.kelvin);
    if (reduced) tint.set(entry.kelvin, now, false);
    const tinting = tint.advance(now), value = tint.state.value;
    if (model && (shown.tinted !== model || shown.r !== value[0] || shown.g !== value[1] || shown.b !== value[2])) {
      shown.tinted = model; shown.r = value[0]; shown.g = value[1]; shown.b = value[2];
      const text = value.join();
      if (model.userData.shownTint !== text) {
        model.userData.shownTint = text;
        model.userData.setTint?.(value);
        dirty();
      }
    }
    return fading || tinting;
  }
  // rust-ui/src/scene_host.rs scene_lamp_switch and rust-ui/src/scene_room.rs scene_lamp_kelvin, as the scene called them.
  function lampSwitch(entry, isOn, animate) {
    const previous = entry.lampPower?.value ?? entry.model?.userData.lightEmitter?.power ?? (entry.isOn === false ? 0 : 1);
    entry.isOn = isOn !== false;
    entry.lampPower = { value:previous, from:previous, target:entry.isOn ? 1 : 0, started:clock(), duration:animate ? 220 : 0 };
  }
  function lampKelvin(entry, kelvin, animate) {
    entry.kelvin = kelvin;
    const tint = entry.lampTint ||= createTintTransition(entry.kelvin);
    tint.set(kelvin, clock(), animate);
  }
  // canDeferModalPaint's and beginInspectionGesture's scans.
  const modalBusy = (entries, now) => entries.some(entry => entry.lampTint?.moving() ||
    Boolean(entry.lampPower && (entry.lampPower.value !== entry.lampPower.target ||
      entry.lampPower.from !== entry.lampPower.target && now < entry.lampPower.started + entry.lampPower.duration)));
  const gestureBusy = (entries, now) => entries.some(entry => Boolean(entry.lampTint?.moving() ||
    entry.lampPower?.duration && entry.lampPower.from !== entry.lampPower.target && now < entry.lampPower.started + entry.lampPower.duration));
  return { advanceLampPower, lampSwitch, lampKelvin, modalBusy, gestureBusy, lampTint };
}
