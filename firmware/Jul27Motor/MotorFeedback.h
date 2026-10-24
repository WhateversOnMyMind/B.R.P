#pragma once

uint16_t g_commandedPwm = 0;

// The sensing loop owns PWM. Apply output guards at the final hardware boundary.
void setVibrationOutput(int pwm) {
  if (!g_motorEnabled || g_recalibrating || !peerIsFresh()) pwm = 0;
  if (pwm < 0) pwm = 0;
  if (pwm > 255) pwm = 255;
  g_commandedPwm = pwm;
  analogWrite(PIN_VIBE, pwm);
  g_alertWindow.continuous(pwm > 0, millis());
}
