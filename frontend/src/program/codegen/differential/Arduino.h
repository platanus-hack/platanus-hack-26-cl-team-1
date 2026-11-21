// Minimal host-side Arduino API used by differential.test.ts: the generated
// sketch is compiled with the host C++ compiler and its Serial output is
// compared with the interpreter's. Semantics follow the ESP32 core (64-bit
// double, libm round) and Arduino's Print::printFloat; time is virtual
// (millis() only advances in delay()).
#pragma once
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <string>

#define HIGH 1
#define LOW 0
#define INPUT 0x01
#define OUTPUT 0x03
#define INPUT_PULLUP 0x05
#define LED_BUILTIN 13
#define RGB_BUILTIN 99
#define A0 14
#define A1 15
#define A2 16
#define A3 17
#define A4 18
#define A5 19
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))

using std::fabs;
using std::fmod;
using std::pow;
using std::round;
using std::sqrt;

static unsigned long cv_now = 0;
static int cv_digital[64];
static int cv_analog[64];
static std::string cv_out;

inline unsigned long millis() { return cv_now; }
inline void delay(unsigned long ms) { cv_now += ms; }
inline void pinMode(int, int) {}
inline void digitalWrite(int, int) {}
inline void analogWrite(int, int) {}
// Optional time-varying input: level of `pin` at virtual time `now` (ms), or -1 to use cv_digital.
static int (*cv_digital_at)(int pin, unsigned long now) = nullptr;
inline int digitalRead(int pin) {
  int v = cv_digital_at ? cv_digital_at(pin, cv_now) : -1;
  return v >= 0 ? v : cv_digital[pin & 63];
}
inline int analogRead(int pin) { return cv_analog[pin & 63]; }
inline void tone(int, unsigned int, unsigned long = 0) {}
inline void noTone(int) {}
inline void rgbLedWrite(int, int, int, int) {}
inline long random(long a, long b) { return a; }

struct CvSerial {
  void begin(long) {}
  void print(const char* s) { cv_out += s; }
  void print(char c) { cv_out += c; }
  void print(bool b) { print((long)b); }
  void print(int v) { print((long)v); }
  void print(unsigned int v) { print((unsigned long)v); }
  void print(long v) { char b[32]; snprintf(b, sizeof b, "%ld", v); cv_out += b; }
  void print(unsigned long v) { char b[32]; snprintf(b, sizeof b, "%lu", v); cv_out += b; }
  // Arduino Print::printFloat
  void print(double number, int digits = 2) {
    if (std::isnan(number)) return print("nan");
    if (std::isinf(number)) return print("inf");
    if (number > 4294967040.0 || number < -4294967040.0) return print("ovf");
    if (number < 0.0) { print('-'); number = -number; }
    double rounding = 0.5;
    for (int i = 0; i < digits; ++i) rounding /= 10.0;
    number += rounding;
    unsigned long int_part = (unsigned long)number;
    double remainder = number - (double)int_part;
    print(int_part);
    if (digits > 0) print('.');
    while (digits-- > 0) {
      remainder *= 10.0;
      unsigned int toPrint = (unsigned int)remainder;
      print(toPrint);
      remainder -= toPrint;
    }
  }
  template <typename T> void println(T v) { print(v); cv_out += "\n"; }
  void println() { cv_out += "\n"; }
};
static CvSerial Serial;

void setup();
void loop();
