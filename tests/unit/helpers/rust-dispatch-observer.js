// The reader classes' members reach their Rust implementations through dispatchers (voice_method,
// picker_method; rustMethods in src/js/readers/rust-ui-required.js), which call those
// implementations inside Rust. Suites that prove a member ran through compiled Rust observe the
// dispatcher instead: countDispatch(module, record) returns a copy of the module whose dispatchers
// report, under the name of the implementation export, each member that reaches them.
export const MEMBER_EXPORTS={
 voice_method:{getDiagnosticState:'voice_diagnostic',restartFromVisiblePage:'voice_restart_visible',play:'voice_play',speakCurrent:'voice_speak_current',
  voiceFor:'voice_for',speakNeural:'voice_speak_neural',upcomingFor:'voice_upcoming',audioItem:'voice_audio_item',needsPageJoin:'voice_needs_join',
  joinPageSentence:'voice_join_sentence',prepareAhead:'voice_prepare_ahead',clearAhead:'voice_clear_ahead',engineFailed:'voice_engine_failed',
  retryNeural:'voice_retry',voiceRemoved:'voice_removed',advance:'voice_advance',jumpToPoint:'voice_jump_point',continueFromPage:'voice_continue_page',
  browse:'voice_browse',returnToAudio:'voice_return_audio',seekToPoint:'voice_seek_point',refreshPageBreaks:'voice_refresh_breaks',prepare:'voice_prepare',
  prepareOpening:'voice_prepare_opening',preparePlayback:'voice_prepare_playback',prepareNext:'voice_prepare_next',pagePlanValid:'voice_page_valid',
  revalidateNext:'voice_revalidate_next',adopt:'voice_adopt_plan',engineStarted:'voice_engine_started',engineEnded:'voice_engine_ended',present:'voice_present',
  unpaint:'voice_unpaint',restart:'voice_restart',cancelUtterance:'voice_cancel',prepareText:'voice_prepare_text',pause:'voice_pause',stop:'voice_stop',
  fail:'voice_fail',setSleep:'voice_set_sleep'},
 picker_method:{warm:'picker_warm',refresh:'picker_refresh',used:'picker_used',attach:'picker_attach',warmContext:'picker_warm_context',
  isWarmCurrent:'picker_warm_current',cancelWarm:'picker_cancel_warm',warmUp:'picker_warm_up',changed:'picker_changed',paint:'picker_paint',
  state:'picker_state',click:'picker_click',cancel:'picker_cancel',voiceName:'picker_voice_name',use:'picker_use',dismissed:'picker_dismissed',
  snoozed:'picker_snoozed',dismiss:'picker_dismiss',offerFor:'picker_offer_for',renderOffer:'picker_render_offer'}
}
export function countDispatch(module,record){
 const copy={...module}
 for(const [dispatch,members] of Object.entries(MEMBER_EXPORTS))copy[dispatch]=(host,name,...rest)=>{
  if(members[name])record(members[name])
  return module[dispatch](host,name,...rest)
 }
 return copy
}
