// Sensing-loop producer only; the capture worker owns flash writes.
void rawLogTick() {
  const Sample& s=g_lastSample;
  capture::Row row{millis(),s.ax,s.ay,s.az,s.gx,s.gy,s.gz,s.tempC};
  capture::sample(row);
}
