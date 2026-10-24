// Cloud action adapter. No local HTTP server or mDNS is started in production.
// The sensing loop is the sole owner of settings, calibration and output.
void cloudActionsTick() {
  capture::Result result;
  if(capture::result(result)) {
    g_commandExecuting=false; g_commandGuard.remember(result.command,result.applied);
    cloud::acknowledge(result.command,result.applied,result.applied?"capture action completed":"capture busy, expired or unavailable");
  }
  if(g_commandExecuting) return;
  cloud::Command command;
  if(!cloud::receive(command)) return;
  const auto captureState=capture::status();
  auto decision=g_commandGuard.check(command,ARM_CHAR,g_bootId,millis(),captureState.id);
  if(decision==cloud::Decision::Duplicate) {
    cloud::acknowledge(command,g_commandGuard.applied,"previous result"); return;
  }
  if(decision==cloud::Decision::Reject) {
    cloud::acknowledge(command,false,"invalid, expired, stale or wrong capture"); return;
  }
  bool applied=true;
  switch(command.action) {
    case cloud::Action::Motor:
      g_motorEnabled=command.boolValue; g_settingsRevision=command.revision;
      if(!g_motorEnabled) setFeedbackIntensity(0.0f);
      break;
    case cloud::Action::Sensitivity:
      g_feedbackDeadZone=command.numberValue; g_settingsRevision=command.revision; break;
    case cloud::Action::Recalibrate:
      g_recalibrating=true; g_commandExecuting=true; g_calibrationCommand=command;
      g_calibrationStart=millis(); g_calibrationSum=0; g_calibrationSamples=0;
      g_inSwing=false; g_dir=0; setFeedbackIntensity(0.0f); return;
    case cloud::Action::RawStart: case cloud::Action::RawStop: case cloud::Action::RawClear:
      if(capture::submit(command)) { g_commandExecuting=true; return; }
      applied=false; break;
    default: applied=false; break;
  }
  g_commandGuard.remember(command,applied);
  cloud::acknowledge(command,applied,applied?"applied":"unavailable");
}

void cloudPublish() {
  static uint32_t last=0;
  if(uint32_t(millis()-last)<100) return;
  last=millis(); cloud::Snapshot s;
  s.arm=ARM_CHAR; s.boot=g_bootId; s.settingsRevision=g_settingsRevision;
  s.motorEnabled=g_motorEnabled; s.feedbackDeadZone=g_feedbackDeadZone;
  s.peerFresh=peerIsFresh(); s.recalibrating=g_recalibrating;
  s.feedbackEligible=s.peerFresh&&g_motorEnabled&&!g_recalibrating;
  s.tempC=g_lastSample.tempC; s.uptimeMs=last;
  s.feedbackIntensity=g_feedbackIntensity; s.toneActive=g_piezoToneOn;
  const auto envelope=firmware_logic::makeFeedbackEnvelope(g_feedbackIntensity,s.feedbackEligible,s.peerFresh);
  s.pulsePeriodMs=envelope.periodMs;
  s.magnetometerReady=g_magnetometerReady;
  s.maxSampleGapUs=g_maxSampleGapUs; s.sampleGapCount=g_sampleGapCount;
  s.window=g_lastWindow; s.windowSequence=g_windowSequence;
  s.windowAlerted=g_lastWindowAlerted; s.capture=capture::status();
  cloud::publish(s);
}
