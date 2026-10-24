#pragma once

#include <Arduino.h>
#include <Wire.h>

#include "FirmwareLogic.h"

class MMC5983MA {
 public:
  static constexpr uint8_t kAddress = 0x30;
  static constexpr uint8_t kExpectedProductId = 0x30;
  static constexpr uint16_t kWireTimeoutMs = 12;
  static constexpr uint16_t kMeasurementTimeoutMs = 20;

  struct Sample {
    int32_t xCounts;
    int32_t yCounts;
    int32_t zCounts;
    float xGauss;
    float yGauss;
    float zGauss;
    uint32_t capturedMs;
  };

  enum class PollResult : uint8_t {
    Idle,
    Pending,
    Fresh,
    BusError,
    TimedOut,
  };

  bool begin(TwoWire& bus, int sda = 4, int scl = 5) {
    wire_ = &bus;
    wire_->setTimeOut(kWireTimeoutMs);
    if (!wire_->begin(sda, scl, 400000U)) return fail();

    // Power-on completion is 10 ms per the MEMSIC datasheet.
    delay(10);
    if (!writeRegister(kControl1, kSoftwareReset)) return fail();
    delay(10);

    uint8_t productId = 0;
    if (!readRegister(kProductId, productId) ||
        productId != kExpectedProductId) {
      return fail();
    }

    // Establish the documented SET polarity. Subsequent measurements enable
    // the device's automatic SET/RESET operation.
    if (!writeRegister(kControl0, kSet)) return fail();
    delay(1);
    ready_ = true;
    busError_ = false;
    pending_ = false;
    return true;
  }

  bool ready() const { return ready_; }
  bool busError() const { return busError_; }
  bool measurementPending() const { return pending_; }

  bool startMeasurement(uint32_t nowMs) {
    if (!ready_ || pending_) return false;
    // TM_M starts a single conversion; Auto_SR_en performs SET/RESET handling.
    if (!writeRegister(kControl0, kAutoSetReset | kTakeMagMeasurement)) {
      return fail();
    }
    startedMs_ = nowMs;
    pending_ = true;
    return true;
  }

  PollResult poll(uint32_t nowMs, Sample& sample) {
    if (!pending_) return PollResult::Idle;

    // Do not turn a conversion completed during a blocked caller into a
    // seemingly current sample. The measurement must be observed on time.
    if (firmware_logic::mmcMeasurementTimedOut(
            nowMs, startedMs_, kMeasurementTimeoutMs)) {
      pending_ = false;
      return PollResult::TimedOut;
    }

    uint8_t status = 0;
    if (!readRegister(kStatus, status)) {
      fail();
      return PollResult::BusError;
    }
    if ((status & kMagMeasurementDone) != 0) {
      uint8_t raw[7] = {};
      if (!readRegisters(kXout0, raw, sizeof(raw))) {
        fail();
        return PollResult::BusError;
      }
      const uint32_t xRaw = firmware_logic::decodeMmc5983Axis(
          raw[0], raw[1], raw[6], 6);
      const uint32_t yRaw = firmware_logic::decodeMmc5983Axis(
          raw[2], raw[3], raw[6], 4);
      const uint32_t zRaw = firmware_logic::decodeMmc5983Axis(
          raw[4], raw[5], raw[6], 2);
      sample.xCounts = firmware_logic::centerMmc5983Counts(xRaw);
      sample.yCounts = firmware_logic::centerMmc5983Counts(yRaw);
      sample.zCounts = firmware_logic::centerMmc5983Counts(zRaw);
      sample.xGauss = sample.xCounts / 16384.0f;
      sample.yGauss = sample.yCounts / 16384.0f;
      sample.zGauss = sample.zCounts / 16384.0f;
      // Trigger time is a conservative lower bound on acquisition time.
      sample.capturedMs = startedMs_;
      pending_ = false;
      return PollResult::Fresh;
    }
    return PollResult::Pending;
  }

 private:
  static constexpr uint8_t kXout0 = 0x00;
  static constexpr uint8_t kStatus = 0x08;
  static constexpr uint8_t kControl0 = 0x09;
  static constexpr uint8_t kControl1 = 0x0a;
  static constexpr uint8_t kProductId = 0x2f;

  static constexpr uint8_t kMagMeasurementDone = 0x01;
  static constexpr uint8_t kTakeMagMeasurement = 0x01;
  static constexpr uint8_t kSet = 0x08;
  static constexpr uint8_t kAutoSetReset = 0x20;
  static constexpr uint8_t kSoftwareReset = 0x80;

  bool fail() {
    pending_ = false;
    ready_ = false;
    busError_ = true;
    return false;
  }

  bool writeRegister(uint8_t reg, uint8_t value) {
    if (wire_ == nullptr) return false;
    wire_->beginTransmission(kAddress);
    wire_->write(reg);
    wire_->write(value);
    return wire_->endTransmission(true) == 0;
  }

  bool readRegister(uint8_t reg, uint8_t& value) {
    return readRegisters(reg, &value, 1);
  }

  bool readRegisters(uint8_t firstReg, uint8_t* values, size_t count) {
    if (wire_ == nullptr || count == 0) return false;
    wire_->beginTransmission(kAddress);
    wire_->write(firstReg);
    if (wire_->endTransmission(false) != 0) return false;
    if (wire_->requestFrom(kAddress, count, true) != count) return false;
    for (size_t i = 0; i < count; ++i) {
      if (!wire_->available()) return false;
      values[i] = static_cast<uint8_t>(wire_->read());
    }
    return true;
  }

  TwoWire* wire_ = nullptr;
  uint32_t startedMs_ = 0;
  bool ready_ = false;
  bool pending_ = false;
  bool busError_ = false;
};
